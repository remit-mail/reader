import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
	AccountItem,
	MailboxItem,
	SpamThresholds,
} from "@remit/data-ports";
import { deriveAddressId } from "@remit/data-ports/id";
import {
	AccountSettingName,
	SpamAction,
	SpamKind,
	SpamLabelPlacement,
	SpamReasonName,
} from "@remit/domain-enums";
import { BodySyncService } from "./body-sync.js";
import { PlacementMoveService } from "./placement-move.js";
import { SyncWarningService } from "./sync-warning.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	messageAtUid,
	openStore,
	type RecordingQueue,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
	syncFolder,
} from "./test-helpers/test-store.js";

const STRANGER = eml(
	{ From: "Parcel desk <desk@parcel-notice.example>", Subject: "Your parcel" },
	"Your parcel is waiting.",
);

interface World {
	store: Store;
	imap: FakeImapServer;
	queue: RecordingQueue;
	account: AccountItem;
	inbox: MailboxItem;
	junk: MailboxItem;
}

const JUNK_FROM_A_SCORE_OF_005: SpamThresholds = {
	state: "Set",
	cleanBelow: 0,
	spamAt: 0.05,
};

let world: World;

beforeEach(async () => {
	const store = await openStore();
	const account = await seedAccount(store);
	const imap = new FakeImapServer();
	for (const path of ["INBOX", "Junk"]) imap.addFolder(path);
	const inbox = await seedMailbox(store, account, "INBOX");
	const junk = await seedMailbox(store, account, "Junk", {
		specialUse: "Junk",
	});
	for (const mailbox of [inbox, junk]) {
		await store.mailbox.update(account.accountId, mailbox.mailboxId, {
			initialSyncCompletedAt: 1,
		});
	}
	world = {
		store,
		imap,
		queue: recordingQueue(),
		account,
		inbox,
		junk,
	};
});

afterEach(async () => {
	await world.store.close();
});

const bodySync = (thresholds: SpamThresholds): BodySyncService => {
	const { store } = world;
	const placementMoveService = new PlacementMoveService({
		messageService: store.message,
		threadMessageService: store.threadMessage,
		markerService: store.placementMove,
		addressService: store.address,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		mailboxService: store.mailbox,
		queue: world.queue,
	});
	return new BodySyncService(
		store.message,
		store.storage(),
		store.threadMessage,
		store.address,
		store.envelope,
		new SyncWarningService(store.syncWarning),
		{
			spamPipeline: [{ name: "Inline", thresholds }],
			domainRegistration: store.domainRegistration,
			rdap: { lookup: async () => ({ state: "Unpublished" }) },
			accountService: store.account,
			accountSetting: store.accountSetting,
			labelService: store.label,
			messageLabelService: store.messageLabel,
			logger: silentLog,
		},
		silentLog,
		{ mailboxSpecialUseService: store.mailboxSpecialUse, placementMoveService },
	);
};

const arriveAndSync = async (
	raw: Buffer,
	thresholds: SpamThresholds,
): Promise<string> => {
	const { store, account, inbox } = world;
	const uid = world.imap.deliver(inbox.fullPath, raw, {
		internalDate: new Date(Date.now() + 60_000),
	});
	await syncFolder(store, account, inbox, world.imap);
	const { messageId } = await messageAtUid(store, inbox, uid);
	await bodySync(thresholds).syncBodies(
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
		async () => world.imap.connection(),
		{ force: false, concurrency: 1, bytesInFlight: 64 * 1024 * 1024 },
	);
	return messageId;
};

const labelNames = async (messageId: string): Promise<string[]> => {
	const { store, account } = world;
	const labels = await store.label.listByAccountConfig(account.accountConfigId);
	return (await store.messageLabel.listByMessageId(messageId)).map(
		(applied) =>
			labels.find((label) => label.labelId === applied.labelId)?.name ?? "",
	);
};

describe("body sync with a spam service", () => {
	it("records the verdict and neither moves nor labels while the thresholds are unset", async () => {
		const messageId = await arriveAndSync(STRANGER, { state: "Unset" });

		const row = await world.store.message.get(messageId);
		assert.equal(row.spamVerdict.state, "Checked");
		assert.equal(
			row.spamVerdict.state === "Checked" && row.spamVerdict.action,
			SpamAction.None,
		);
		assert.deepEqual(
			row.spamVerdict.state === "Checked" &&
				row.spamVerdict.reasons.map((reason) => reason.name),
			[
				SpamReasonName.FirstContactDomain,
				SpamReasonName.UnknownRegistrationDate,
			],
		);
		assert.equal(row.mailboxId, world.inbox.mailboxId);
		assert.deepEqual(world.queue.sent, []);
		assert.deepEqual(await labelNames(messageId), []);
		assert.deepEqual(
			(await world.store.domainRegistration.get("parcel-notice.example"))
				.registration,
			{ state: "Unpublished" },
		);
	});

	it("moves a lookalike-domain message to Junk with the Phishing label", async () => {
		const messageId = await arriveAndSync(
			eml(
				{
					From: "Bank <alerts@rnybank.example>",
					Subject: "Verify your account",
					"Content-Type": "text/html; charset=utf-8",
				},
				'<p><a href="https://mybank.example/verify">Verify</a></p>',
			),
			JUNK_FROM_A_SCORE_OF_005,
		);

		const row = await world.store.message.get(messageId);
		assert.equal(
			row.spamVerdict.state === "Checked" && row.spamVerdict.kind,
			SpamKind.Phishing,
		);
		assert.equal(row.mailboxId, world.junk.mailboxId);
		assert.equal(row.movedByRemit, true);
		assert.deepEqual(await labelNames(messageId), ["Phishing"]);
	});

	it("labels a Junk verdict in place when the owner set Spam to warn only", async () => {
		await world.store.accountSetting.upsert({
			accountConfigId: world.account.accountConfigId,
			name: AccountSettingName.SpamPlacementSpam,
			value: { kind: "String", value: SpamLabelPlacement.WarnOnly },
		});

		const messageId = await arriveAndSync(STRANGER, JUNK_FROM_A_SCORE_OF_005);

		const row = await world.store.message.get(messageId);
		assert.equal(
			row.spamVerdict.state === "Checked" && row.spamVerdict.action,
			SpamAction.Junk,
		);
		assert.equal(row.mailboxId, world.inbox.mailboxId);
		assert.deepEqual(world.queue.sent, []);
		assert.deepEqual(await labelNames(messageId), ["Spam"]);
	});

	it("sends a reported sender to Junk with the Spam label and no check", async () => {
		const { store, account } = world;
		const email = "desk@parcel-notice.example";
		const addressId = deriveAddressId(account.accountConfigId, email);
		await store.address.upsertAddress({
			addressId,
			accountConfigId: account.accountConfigId,
			localPart: "desk",
			domain: "parcel-notice.example",
			normalizedEmail: email,
			normalizedCompound: email,
		});
		await store.address.updateAddress(account.accountConfigId, addressId, {
			flags: { blocked: { value: true, setAt: 1 } },
		});

		const messageId = await arriveAndSync(STRANGER, JUNK_FROM_A_SCORE_OF_005);

		const row = await world.store.message.get(messageId);
		assert.deepEqual(row.spamVerdict, {
			state: "ScreenedOut",
			screen: { rule: "ReportedSender" },
		});
		assert.equal(row.mailboxId, world.junk.mailboxId);
		assert.equal(row.movedByRemit, true);
		assert.deepEqual(await labelNames(messageId), ["Spam"]);
	});

	it("screens a VIP sender out without asking the spam service", async () => {
		const { store, account } = world;
		const email = "desk@parcel-notice.example";
		const addressId = deriveAddressId(account.accountConfigId, email);
		await store.address.upsertAddress({
			addressId,
			accountConfigId: account.accountConfigId,
			localPart: "desk",
			domain: "parcel-notice.example",
			normalizedEmail: email,
			normalizedCompound: email,
		});
		await store.address.updateAddress(account.accountConfigId, addressId, {
			flags: { vip: { value: true, setAt: 1 } },
		});

		const messageId = await arriveAndSync(STRANGER, JUNK_FROM_A_SCORE_OF_005);

		assert.deepEqual((await world.store.message.get(messageId)).spamVerdict, {
			state: "ScreenedOut",
			screen: { rule: "Vip" },
		});
	});
});
