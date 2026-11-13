import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
	AccountItem,
	MailboxItem,
	SpamRequest,
	SpamService,
} from "@remit/data-ports";
import { deriveAddressId } from "@remit/data-ports/id";
import { SpamAction, SpamReasonName } from "@remit/domain-enums";
import { BodySyncService } from "./body-sync.js";
import { PlacementMoveService } from "./placement-move.js";
import { InlineSpamService } from "./spam/index.js";
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
	requests: SpamRequest[];
}

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
		requests: [],
	};
});

afterEach(async () => {
	await world.store.close();
});

const bodySync = (): BodySyncService => {
	const { store } = world;
	const inline = new InlineSpamService({
		state: "Set",
		cleanBelow: 0,
		spamAt: 0.05,
	});
	const spamService: SpamService = {
		check: (request) => {
			world.requests.push(request);
			return inline.check(request);
		},
	};
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
			spamService,
			domainRegistration: store.domainRegistration,
			rdap: { lookup: async () => ({ state: "Unpublished" }) },
			accountService: store.account,
			logger: silentLog,
		},
		silentLog,
		{ mailboxSpecialUseService: store.mailboxSpecialUse, placementMoveService },
	);
};

const arriveAndSync = async (raw: Buffer): Promise<string> => {
	const { store, account, inbox } = world;
	const uid = world.imap.deliver(inbox.fullPath, raw, {
		internalDate: new Date(Date.now() + 60_000),
	});
	await syncFolder(store, account, inbox, world.imap);
	const { messageId } = await messageAtUid(store, inbox, uid);
	await bodySync().syncBodies(
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

describe("body sync with a spam service", () => {
	it("records the verdict and leaves the message where it arrived", async () => {
		const messageId = await arriveAndSync(STRANGER);

		const row = await world.store.message.get(messageId);
		assert.equal(row.spamVerdict.state, "Checked");
		assert.equal(
			row.spamVerdict.state === "Checked" && row.spamVerdict.action,
			SpamAction.Junk,
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
		assert.deepEqual(
			(await world.store.domainRegistration.get("parcel-notice.example"))
				.registration,
			{ state: "Unpublished" },
		);
	});

	it("screens a VIP sender out without asking the spam service", async () => {
		const email = "desk@parcel-notice.example";
		const addressId = deriveAddressId(world.account.accountConfigId, email);
		await world.store.address.upsertAddress({
			addressId,
			accountConfigId: world.account.accountConfigId,
			localPart: "desk",
			domain: "parcel-notice.example",
			normalizedEmail: email,
			normalizedCompound: email,
		});
		await world.store.address.updateAddress(
			world.account.accountConfigId,
			addressId,
			{ flags: { vip: { value: true, setAt: 1 } } },
		);

		const messageId = await arriveAndSync(STRANGER);

		assert.deepEqual((await world.store.message.get(messageId)).spamVerdict, {
			state: "ScreenedOut",
			screen: { rule: "Vip" },
		});
		assert.deepEqual(world.requests, []);
	});
});
