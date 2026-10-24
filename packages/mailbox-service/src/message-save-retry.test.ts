import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
	AccountItem,
	IThreadMessageRepository,
	MailboxItem,
} from "@remit/data-ports";
import { MessageSyncService } from "./message-sync.js";
import { SyncWarningService } from "./sync-warning.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
} from "./test-helpers/test-store.js";

let store: Store;
let imap: FakeImapServer;
let account: AccountItem;
let inbox: MailboxItem;

beforeEach(async () => {
	store = await openStore();
	imap = new FakeImapServer();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	imap.addFolder("INBOX");
});

afterEach(() => store.close());

/** The thread store, refusing its first create: the last write of a save. */
const failingFirstCreate = (
	inner: IThreadMessageRepository,
): IThreadMessageRepository => {
	let refused = false;
	return Object.assign(Object.create(inner), {
		create: (...args: Parameters<IThreadMessageRepository["create"]>) => {
			if (!refused) {
				refused = true;
				return Promise.reject(new Error("the thread write failed"));
			}
			return inner.create(...args);
		},
	});
};

const syncOnce = (threadMessage: IThreadMessageRepository) =>
	new MessageSyncService(
		{ getConnection: () => imap.connection(), close: async () => {} },
		store.mailbox,
		store.mailboxSpecialUse,
		store.message,
		store.envelope,
		store.address,
		threadMessage,
		new SyncWarningService(store.syncWarning),
		silentLog,
	).syncMessages(inbox.mailboxId, account.accountId, account.accountConfigId);

describe("a message save that fails at its last write", () => {
	it("is completed by the next round, with one row of each", async () => {
		imap.deliver(
			"INBOX",
			eml({ Subject: "Halfway", "Message-ID": "<halfway@example.test>" }),
		);
		const threadMessage = failingFirstCreate(store.threadMessage);

		await syncOnce(threadMessage);
		await syncOnce(threadMessage);

		const messages = await store.message.listAllByMailbox(inbox.mailboxId);
		assert.equal(messages.length, 1);
		const [message] = messages;
		assert.ok(message);
		assert.equal(
			(
				await store.threadMessage.findAllByMessageId(
					account.accountConfigId,
					message.messageId,
				)
			).length,
			1,
		);
	});
});
