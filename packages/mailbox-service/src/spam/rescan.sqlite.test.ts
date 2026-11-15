import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem, SpamPipeline } from "@remit/data-ports";
import {
	classificationUsageName,
	utcDateOf,
} from "@remit/data-ports/classification-presets";
import { deriveAddressId } from "@remit/data-ports/id";
import {
	AccountSettingName,
	MessageKeywordFlag,
	PlacementAction,
	RescanFailureCode,
	SpamAction,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "../body-sync.js";
import { ensureLabel } from "../classification-labels.js";
import { FlagPushService } from "../flag-push.js";
import { MessageMoveService } from "../message-move.js";
import { SpamReportService } from "../spam-report.js";
import { SyncWarningService } from "../sync-warning.js";
import { saveClassifierProvider } from "../test-helpers/classifier-stub.js";
import { eml, FakeImapServer } from "../test-helpers/fake-imap.js";
import { closedPortBaseUrl } from "../test-helpers/stub-http-server.js";
import {
	arriveAt,
	messageAtUid,
	openStore,
	recordingQueue,
	rescanServiceFor,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
	spamConfigFor,
	storeBody,
	syncFolder,
} from "../test-helpers/test-store.js";
import type { SpamConfig } from "./index.js";

const WARN_ALL: SpamPipeline = [
	{ name: "Inline", thresholds: { state: "Set", cleanBelow: 0, spamAt: 1 } },
];

const from = (email: string, subject: string): Buffer =>
	eml({ From: `Sender <${email}>`, Subject: subject }, "Hello there.");

interface World {
	store: Store;
	storage: StorageService;
	imap: FakeImapServer;
	account: AccountItem;
	inbox: MailboxItem;
}

let world: World;

beforeEach(async () => {
	const store = await openStore();
	const account = await seedAccount(store);
	const imap = new FakeImapServer();
	imap.addFolder("INBOX");
	const inbox = await seedMailbox(store, account, "INBOX");
	await store.mailbox.update(account.accountId, inbox.mailboxId, {
		initialSyncCompletedAt: 1,
	});
	world = { store, storage: store.storage(), imap, account, inbox };
});

afterEach(async () => {
	await world.store.close();
});

const arriveAndSync = async (
	raw: Buffer,
	spam: SpamConfig = spamConfigFor(world.store),
): Promise<string> => {
	const { store, storage, account, inbox, imap } = world;
	const uid = imap.deliver(inbox.fullPath, raw, {
		internalDate: new Date(Date.now() + 60_000),
	});
	await syncFolder(store, account, inbox, imap);
	const { messageId } = await messageAtUid(store, inbox, uid);
	await new BodySyncService(
		store.message,
		storage,
		store.threadMessage,
		store.address,
		store.envelope,
		new SyncWarningService(store.syncWarning),
		spam,
		silentLog,
	).syncBodies(
		[messageId],
		account.accountId,
		account.accountConfigId,
		{
			mailboxId: inbox.mailboxId,
			fullPath: inbox.fullPath,
			placement: "inbox",
			uidValidity: inbox.uidValidity,
			createdAt: inbox.createdAt,
			initialSyncCompletedAt: 1,
		},
		async () => imap.connection(),
		{ force: false, concurrency: 1, bytesInFlight: 64 * 1024 * 1024 },
	);
	return messageId;
};

const neverSpam = async (email: string): Promise<void> => {
	const { store, account } = world;
	const addressId = deriveAddressId(account.accountConfigId, email);
	const [localPart, domain] = email.split("@");
	await store.address.upsertAddress({
		addressId,
		accountConfigId: account.accountConfigId,
		localPart,
		domain,
		normalizedEmail: email,
		normalizedCompound: email,
	});
	await store.address.updateAddress(account.accountConfigId, addressId, {
		flags: { neverSpam: { value: true, setAt: 1 } },
	});
};

const upsertSetting = (
	name: string,
	value: Parameters<Store["accountSetting"]["upsert"]>[0]["value"],
) =>
	world.store.accountSetting.upsert({
		accountConfigId: world.account.accountConfigId,
		name,
		value,
	});

describe("rescan", () => {
	it("answers each message on its own and keeps a decided category", async () => {
		const screened = await arriveAndSync(
			eml(
				{
					From: "Shop <deals@shop.example>",
					Subject: "Half price",
					"List-Unsubscribe": "<https://shop.example/unsub>",
				},
				"Everything must go.",
			),
		);
		await neverSpam("deals@shop.example");
		const capped = await arriveAndSync(
			from("desk@parcel-notice.example", "Your parcel"),
		);
		const categoryBefore = (await world.store.message.get(screened)).category;

		await saveClassifierProvider(
			world.store.accountSetting,
			world.account.accountConfigId,
			await closedPortBaseUrl(),
		);
		await upsertSetting(AccountSettingName.ClassificationDailyLimit, {
			kind: "Number",
			value: 1,
		});
		await upsertSetting(classificationUsageName(world.account.accountId), {
			kind: "DailyCount",
			value: { date: utcDateOf(Date.now()), calls: 1 },
		});
		const missing = randomUUID();

		const result = await rescanServiceFor(
			world.store,
			world.storage,
			recordingQueue(),
		).rescan(world.account, {
			messageIds: [screened, missing, capped],
			move: false,
		});

		assert.deepEqual(result.successful, [
			{
				messageId: screened,
				verdict: { state: "ScreenedOut", screen: { rule: "NeverSpam" } },
				labels: [],
			},
		]);
		assert.deepEqual(result.failed, [
			{
				messageId: missing,
				code: RescanFailureCode.NotFound,
				retryable: false,
			},
			{
				messageId: capped,
				code: RescanFailureCode.DailyCap,
				retryable: true,
			},
		]);
		assert.equal(
			(await world.store.message.get(screened)).category,
			categoryBefore,
		);
	});

	it("never labels a message the owner marked Not spam", async () => {
		const cleared = await arriveAndSync(
			from("desk@parcel-notice.example", "Your parcel"),
		);
		const suspect = await arriveAndSync(
			from("desk@parcel-notice.example", "Your parcel again"),
		);
		await world.store.messageFlag.addFlag(cleared, MessageKeywordFlag.NotJunk);

		const result = await rescanServiceFor(
			world.store,
			world.storage,
			recordingQueue(),
			{
				...spamConfigFor(world.store),
				spamPipeline: WARN_ALL,
			},
		).rescan(world.account, { messageIds: [cleared, suspect], move: true });

		const byId = new Map(
			result.successful.map((success) => [success.messageId, success]),
		);
		const clearedResult = byId.get(cleared);
		assert.equal(
			clearedResult?.verdict.state === "Checked" &&
				clearedResult.verdict.action,
			SpamAction.Warn,
		);
		assert.deepEqual(clearedResult?.labels, []);
		assert.deepEqual(
			await world.store.messageLabel.listByMessageId(cleared),
			[],
		);
		assert.deepEqual(byId.get(suspect)?.labels, ["Spam"]);
	});

	it("drops the warning label on Not spam and a rescan does not bring it back", async () => {
		const { store, storage, account } = world;
		const warnAll: SpamConfig = {
			...spamConfigFor(store),
			spamPipeline: WARN_ALL,
		};
		const messageId = await arriveAndSync(
			from("desk@parcel-notice.example", "Your parcel"),
			warnAll,
		);
		const labelNames = async () =>
			Promise.all(
				(await store.messageLabel.listByMessageId(messageId)).map(
					async (row) =>
						(await store.label.get(account.accountConfigId, row.labelId)).name,
				),
			);
		assert.deepEqual(await labelNames(), ["Spam"]);

		const queue = recordingQueue();
		await new SpamReportService({
			messageService: store.message,
			addressService: store.address,
			accountService: store.account,
			mailboxSpecialUseService: store.mailboxSpecialUse,
			labelService: store.label,
			messageLabelService: store.messageLabel,
			messageMoveService: new MessageMoveService({
				messageService: store.message,
				mailboxService: store.mailbox,
				mailboxSpecialUseService: store.mailboxSpecialUse,
				threadMessageService: store.threadMessage,
				addressService: store.address,
				queue: queue.fifo,
			}),
			flagPushService: new FlagPushService({
				markerService: store.flagPush,
				queue: queue.fifo,
			}),
		}).notSpam({
			accountConfigId: account.accountConfigId,
			accountId: account.accountId,
			messageId,
			setBy: "user-1",
		});

		assert.deepEqual(await labelNames(), []);
		assert.equal((await store.message.get(messageId)).spamCleared, true);

		const result = await rescanServiceFor(
			store,
			storage,
			queue,
			warnAll,
		).rescan(account, { messageIds: [messageId], move: true });

		assert.deepEqual(result.successful[0]?.labels, []);
		assert.deepEqual(await labelNames(), []);
		assert.equal((await store.message.get(messageId)).spamCleared, true);
	});

	it("takes a stale Spam label back when the rescan no longer warns", async () => {
		const { store, storage, account } = world;
		const messageId = await arriveAndSync(
			from("desk@parcel-notice.example", "Your parcel"),
			{ ...spamConfigFor(store), spamPipeline: WARN_ALL },
		);
		assert.equal(
			(await store.messageLabel.listByMessageId(messageId)).length,
			1,
		);

		const result = await rescanServiceFor(
			store,
			storage,
			recordingQueue(),
		).rescan(account, { messageIds: [messageId], move: false });

		assert.deepEqual(result.successful[0]?.labels, []);
		assert.deepEqual(await store.messageLabel.listByMessageId(messageId), []);
	});

	it("keeps a Spam label the owner applied by hand on a clean rescan", async () => {
		const { store, storage, account } = world;
		const messageId = await arriveAndSync(
			from("desk@parcel-notice.example", "Your parcel"),
		);
		assert.deepEqual(await store.messageLabel.listByMessageId(messageId), []);
		const spamLabel = await ensureLabel(
			store.label,
			account.accountConfigId,
			"Spam",
		);
		await store.messageLabel.apply({
			messageId,
			labelId: spamLabel.labelId,
			accountConfigId: account.accountConfigId,
		});

		const result = await rescanServiceFor(
			store,
			storage,
			recordingQueue(),
		).rescan(account, { messageIds: [messageId], move: false });

		assert.deepEqual(result.successful[0]?.labels, []);
		assert.deepEqual(
			(await store.messageLabel.listByMessageId(messageId)).map(
				(row) => row.labelId,
			),
			[spamLabel.labelId],
		);
	});

	it("keeps the Spam label of a reported message on a clean rescan", async () => {
		const { store, storage, account } = world;
		const messageId = await arriveAndSync(
			from("desk@parcel-notice.example", "Your parcel"),
			{ ...spamConfigFor(store), spamPipeline: WARN_ALL },
		);
		await store.message.update(messageId, {
			spamReport: { reportedAt: 1 },
		});

		const result = await rescanServiceFor(
			store,
			storage,
			recordingQueue(),
		).rescan(account, { messageIds: [messageId], move: false });

		assert.deepEqual(result.successful[0]?.labels, []);
		assert.equal(
			(await store.messageLabel.listByMessageId(messageId)).length,
			1,
		);
	});
});

describe("rescan out of Junk", () => {
	it("moves a trusted sender's message to the Inbox only when asked to move", async () => {
		const { store, storage, imap, account, inbox } = world;
		const junk = await seedMailbox(store, account, "Junk", {
			specialUse: "Junk",
		});
		imap.addFolder(junk.fullPath);
		const inJunk = async (email: string): Promise<string> => {
			const raw = from(email, "Your invoice");
			const messageId = await arriveAt(store, imap, account, junk, raw);
			await storeBody(store, storage, account, messageId, raw);
			return messageId;
		};
		const rescan = (messageIds: string[], move: boolean) =>
			rescanServiceFor(store, storage, recordingQueue()).rescan(account, {
				messageIds,
				move,
			});
		const mailboxOf = async (messageId: string): Promise<string> =>
			(await store.message.get(messageId)).mailboxId;

		const trusted = await inJunk("billing@supplier.example");
		const stranger = await inJunk("desk@parcel-notice.example");
		await neverSpam("billing@supplier.example");

		await rescan([trusted, stranger], false);
		assert.equal(await mailboxOf(trusted), junk.mailboxId);

		await rescan([trusted, stranger], true);
		const rescued = await store.message.get(trusted);
		assert.equal(rescued.mailboxId, inbox.mailboxId);
		assert.equal(rescued.placementVerdict?.action, PlacementAction.MoveToInbox);
		assert.equal(rescued.placementVerdict?.fromPlacement, "junk");
		assert.equal(await mailboxOf(stranger), junk.mailboxId);
	});
});
