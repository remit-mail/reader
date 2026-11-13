import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import {
	classificationUsageName,
	utcDateOf,
} from "@remit/data-ports/classification-presets";
import { deriveAddressId } from "@remit/data-ports/id";
import {
	AccountSettingName,
	MessageKeywordFlag,
	RescanFailureCode,
	SpamAction,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "../body-sync.js";
import { SyncWarningService } from "../sync-warning.js";
import { saveClassifierProvider } from "../test-helpers/classifier-stub.js";
import { eml, FakeImapServer } from "../test-helpers/fake-imap.js";
import { closedPortBaseUrl } from "../test-helpers/stub-http-server.js";
import {
	messageAtUid,
	openStore,
	recordingQueue,
	rescanServiceFor,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
	spamConfigFor,
	syncFolder,
} from "../test-helpers/test-store.js";
import { InlineSpamService } from "./index.js";

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

const arriveAndSync = async (raw: Buffer): Promise<string> => {
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
		spamConfigFor(store),
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
		const warnAll = new InlineSpamService({
			state: "Set",
			cleanBelow: 0,
			spamAt: 1,
		});

		const result = await rescanServiceFor(
			world.store,
			world.storage,
			recordingQueue(),
			{
				...spamConfigFor(world.store),
				spamService: warnAll,
				thresholds: { state: "Set", cleanBelow: 0, spamAt: 1 },
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
});
