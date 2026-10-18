import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
	AccountItem,
	ISyncWarningRepository,
	MailboxItem,
} from "@remit/data-ports";
import { BodySyncService } from "./body-sync.js";
import { MessageSyncService } from "./message-sync.js";
import { SyncWarningService } from "./sync-warning.js";
import {
	eml,
	type FakeImapConnection,
	FakeImapServer,
} from "./test-helpers/fake-imap.js";
import {
	messageAtUid,
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
	syncFolder,
} from "./test-helpers/test-store.js";

let store: Store;
let imap: FakeImapServer;
let connection: FakeImapConnection;
let account: AccountItem;
let inbox: MailboxItem;

beforeEach(async () => {
	store = await openStore();
	imap = new FakeImapServer();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	imap.addFolder("INBOX");
	connection = imap.connection();
});

afterEach(async () => {
	await store.close();
});

const syncHeaders = (
	syncWarnings: ISyncWarningRepository = store.syncWarning,
) =>
	new MessageSyncService(
		{ getConnection: () => connection, close: async () => {} },
		store.mailbox,
		store.mailboxSpecialUse,
		store.message,
		store.envelope,
		store.address,
		store.threadMessage,
		silentLog,
		store.unitOfWork,
		store.flagPush,
		store.messageFlag,
		undefined,
		new SyncWarningService(syncWarnings),
	).syncMessages(inbox.mailboxId, account.accountId, account.accountConfigId);

const syncBody = (messageId: string, source: FakeImapConnection) =>
	new BodySyncService(
		store.message,
		store.storage(),
		store.threadMessage,
		store.address,
		store.envelope,
		silentLog,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		store.unitOfWork,
		{
			syncWarningService: new SyncWarningService(store.syncWarning),
			uidValidity: inbox.uidValidity,
		},
	).syncBodies(
		[messageId],
		account.accountId,
		account.accountConfigId,
		{ mailboxId: inbox.mailboxId, fullPath: "INBOX", placement: "inbox" },
		async () => source,
	);

const warnings = async () =>
	(await store.syncWarning.listByMailboxId(inbox.mailboxId)).map(
		({ uid, stage, attempts }) => ({ uid, stage, attempts }),
	);

const dropEnvelopes = () => {
	const fetch = connection.fetchMessages;
	connection.fetchMessages = async (uids) =>
		(await fetch(uids)).map((row) => ({ ...row, envelope: undefined }));
	return () => {
		connection.fetchMessages = fetch;
	};
};

describe("a message whose headers fail to sync", () => {
	it("keeps one warning that counts every failed round", async () => {
		const uid = imap.deliver("INBOX", eml({ "Message-ID": "<a@example.com>" }));
		dropEnvelopes();

		for (let round = 0; round < 3; round++) await syncHeaders();

		assert.deepEqual(await warnings(), [{ uid, stage: "Header", attempts: 3 }]);
	});

	it("drops the warning once the message syncs", async () => {
		imap.deliver("INBOX", eml({ "Message-ID": "<a@example.com>" }));
		const restore = dropEnvelopes();
		await syncHeaders();
		restore();

		const result = await syncHeaders();

		assert.equal(result.syncedCount, 1);
		assert.deepEqual(await warnings(), []);
	});

	it("fails the round when the warning cannot be written", async () => {
		imap.deliver("INBOX", eml({ "Message-ID": "<a@example.com>" }));
		dropEnvelopes();
		const failing: ISyncWarningRepository = {
			...store.syncWarning,
			recordFailures: async () => {
				throw new Error("database is locked");
			},
		};

		await assert.rejects(syncHeaders(failing), /database is locked/);
	});

	it("goes with its mailbox", async () => {
		imap.deliver("INBOX", eml({ "Message-ID": "<a@example.com>" }));
		dropEnvelopes();
		await syncHeaders();

		await store.mailbox.delete(account.accountId, inbox.mailboxId);

		assert.deepEqual(await warnings(), []);
	});
});

describe("a message whose body fails to sync", () => {
	it("keeps one warning per failed round and drops it once the body is stored", async () => {
		const uid = imap.deliver("INBOX", eml({ "Message-ID": "<b@example.com>" }));
		await syncFolder(store, account, inbox, imap);
		const { messageId } = await messageAtUid(store, inbox, uid);
		const silent = imap.connection();
		silent.fetchMessageBodies = async function* () {
			yield* [];
		};

		for (let round = 0; round < 3; round++) await syncBody(messageId, silent);

		assert.deepEqual(await warnings(), [{ uid, stage: "Body", attempts: 3 }]);

		const result = await syncBody(messageId, imap.connection());

		assert.deepEqual(result.failedMessageIds, []);
		assert.deepEqual(await warnings(), []);
	});
});
