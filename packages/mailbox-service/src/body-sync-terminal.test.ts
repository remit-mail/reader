import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import {
	isMessageBodySyncBroken,
	resolveExhaustedBodySyncFailures,
} from "./body-sync-terminal.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
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
let storage: StorageService;
let imap: FakeImapServer;
let account: AccountItem;
let inbox: MailboxItem;

beforeEach(async () => {
	store = await openStore();
	storage = store.storage();
	imap = new FakeImapServer();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	imap.addFolder("INBOX");
});

afterEach(() => store.close());

const arrive = async (subject: string) => {
	const uid = imap.deliver("INBOX", eml({ Subject: subject }));
	await syncFolder(store, account, inbox, imap);
	return { uid, messageId: (await messageAtUid(store, inbox, uid)).messageId };
};

const resolve = (failedMessageIds: string[], connection = imap.connection()) =>
	resolveExhaustedBodySyncFailures(
		{
			messageService: store.message,
			threadMessageService: store.threadMessage,
			storageService: storage,
			log: silentLog,
		},
		{
			accountId: account.accountId,
			accountConfigId: account.accountConfigId,
			mailboxId: inbox.mailboxId,
			mailboxPath: "INBOX",
			failedMessageIds,
			getConnection: async () => connection,
		},
	);

const isBroken = (messageId: string) =>
	isMessageBodySyncBroken(
		storage,
		account.accountConfigId,
		account.accountId,
		messageId,
	);

describe("a body sync that exhausted its retries", () => {
	it("removes the row and every thread copy of a message the server expunged", async () => {
		const { uid, messageId } = await arrive("gone");
		const [row] = await store.threadMessage.findAllByMessageId(
			account.accountConfigId,
			messageId,
		);
		await store.threadMessage.create({ ...row, threadId: "drifted-root" });
		imap.expunge("INBOX", uid);

		const result = await resolve([messageId]);

		assert.deepEqual(result, {
			reconciledMessageIds: [messageId],
			brokenMessageIds: [],
		});
		await assert.rejects(store.message.get(messageId));
		assert.deepEqual(
			await store.threadMessage.findAllByMessageId(
				account.accountConfigId,
				messageId,
			),
			[],
		);
		assert.equal(await isBroken(messageId), false);
	});

	it("marks a message the server still holds as broken and keeps its row", async () => {
		const { messageId } = await arrive("broken");

		const result = await resolve([messageId]);

		assert.deepEqual(result.brokenMessageIds, [messageId]);
		assert.ok(await store.message.get(messageId));
		assert.equal(await isBroken(messageId), true);
	});

	it("does not read a dropped FETCH row as absence", async () => {
		const first = await arrive("first");
		const second = await arrive("second");
		const connection = imap.connection();
		const fetch = connection.fetchMessages;
		connection.fetchMessages = async (uids) =>
			uids.includes(second.uid) ? [] : fetch(uids);

		const result = await resolve(
			[first.messageId, second.messageId],
			connection,
		);

		assert.deepEqual(result.reconciledMessageIds, []);
		assert.deepEqual(result.brokenMessageIds, [
			first.messageId,
			second.messageId,
		]);
		assert.ok(await store.message.get(second.messageId));
	});

	it("never opens a connection when nothing failed", async () => {
		const result = await resolveExhaustedBodySyncFailures(
			{
				messageService: store.message,
				threadMessageService: store.threadMessage,
				storageService: storage,
				log: silentLog,
			},
			{
				accountId: account.accountId,
				accountConfigId: account.accountConfigId,
				mailboxId: inbox.mailboxId,
				mailboxPath: "INBOX",
				failedMessageIds: [],
				getConnection: async () => assert.fail("no connection is needed"),
			},
		);

		assert.deepEqual(result, {
			reconciledMessageIds: [],
			brokenMessageIds: [],
		});
	});
});
