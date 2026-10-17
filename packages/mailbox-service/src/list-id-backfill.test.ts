import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import {
	backfillListIds,
	type ListIdBackfillCheckpoint,
} from "./list-id-backfill.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	arriveAt,
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	storeBody,
} from "./test-helpers/test-store.js";

const LIST = eml({
	From: "Weekly News <news@example.com>",
	"List-Id": "Weekly News <weekly.news.example.com>",
});

const PLAIN = eml({ From: "Alice <alice@example.com>" });

const MALFORMED = Buffer.from(
	[
		"From: Weird <weird@example.com>",
		"Subject: Odd header",
		"List-Id:",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

let store: Store;
let storage: StorageService;
let imap: FakeImapServer;
let account: AccountItem;
let inbox: MailboxItem;

beforeEach(async () => {
	store = await openStore();
	storage = store.storage();
	imap = new FakeImapServer();
	imap.addFolder("INBOX");
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
});

afterEach(() => store.close());

const stored = async (
	raw: Buffer,
	owner: AccountItem = account,
	mailbox: MailboxItem = inbox,
): Promise<string> => {
	const messageId = await arriveAt(store, imap, owner, mailbox, raw);
	await storeBody(store, storage, owner, messageId, raw);
	return messageId;
};

const deps = () => ({
	accountConfigService: store.accountConfig,
	threadMessageService: store.threadMessage,
	messageService: store.message,
	storageService: storage,
});

const listIdOf = async (messageId: string, owner: AccountItem = account) =>
	(
		await store.threadMessage.findAllByMessageId(
			owner.accountConfigId,
			messageId,
		)
	)[0].listId;

const memoryCheckpoint = () => {
	let saved: ListIdBackfillCheckpoint | undefined;
	return {
		load: async () => saved,
		save: async (next: ListIdBackfillCheckpoint) => {
			saved = next;
		},
		clear: async () => {
			saved = undefined;
		},
	};
};

describe("backfillListIds", () => {
	it("writes the List-Id a stored body carries", async () => {
		const messageId = await stored(LIST);

		const result = await backfillListIds(deps());

		assert.equal(result.backfilled, 1);
		assert.equal(await listIdOf(messageId), "weekly.news.example.com");
	});

	it("leaves the field empty for mail with no or a malformed List-Id", async () => {
		const plain = await stored(PLAIN);
		const malformed = await stored(MALFORMED);

		const result = await backfillListIds(deps());

		assert.equal(result.noListId, 2);
		assert.equal(result.failed, 0);
		assert.equal(await listIdOf(plain), undefined);
		assert.equal(await listIdOf(malformed), undefined);
	});

	it("skips rows already carrying a List-Id and rows with no stored body", async () => {
		const set = await stored(LIST);
		const [row] = await store.threadMessage.findAllByMessageId(
			account.accountConfigId,
			set,
		);
		await store.threadMessage.update(
			account.accountConfigId,
			row.threadMessageId,
			{ listId: "already.set" },
		);
		await arriveAt(store, imap, account, inbox, LIST);

		const result = await backfillListIds(deps());

		assert.equal(result.alreadySet, 1);
		assert.equal(result.skippedNoBody, 1);
		assert.equal(await listIdOf(set), "already.set");
	});

	it("contains a storage failure to the one message and keeps going", async () => {
		const lost = await arriveAt(store, imap, account, inbox, LIST);
		await store.message.update(lost, {
			bodyStorageKey: "file:///nonexistent/remit/body.eml",
		});
		const fine = await stored(LIST);

		const result = await backfillListIds(deps());

		assert.equal(result.failed, 1);
		assert.equal(await listIdOf(fine), "weekly.news.example.com");
	});

	it("resumes the account it was in after an earlier account is removed", async () => {
		const owners = [
			await seedAccount(store, { accountConfigId: "cfg-1" }),
			await seedAccount(store, { accountConfigId: "cfg-2" }),
			await seedAccount(store, { accountConfigId: "cfg-3" }),
		];
		const ids = new Map<string, string[]>();
		for (const owner of owners) {
			imap.addFolder(`INBOX-${owner.accountConfigId}`);
			const mailbox = await seedMailbox(
				store,
				owner,
				`INBOX-${owner.accountConfigId}`,
			);
			const count = owner.accountConfigId === "cfg-2" ? 2 : 1;
			const mine: string[] = [];
			for (let i = 0; i < count; i++)
				mine.push(await stored(LIST, owner, mailbox));
			ids.set(owner.accountConfigId, mine);
		}
		await store.accountConfig.delete(account.accountConfigId);
		const checkpointStore = memoryCheckpoint();
		let pages = 0;

		await assert.rejects(
			backfillListIds(deps(), {
				batchSize: 1,
				checkpointStore,
				onProgress: (progress) => {
					if (progress.accountConfigId === "cfg-2" && ++pages === 1) {
						throw new Error("killed");
					}
				},
			}),
		);
		await store.accountConfig.delete("cfg-1");
		const resumed = await backfillListIds(deps(), {
			batchSize: 1,
			checkpointStore,
		});

		assert.equal(resumed.backfilled, 2);
		assert.equal(resumed.scanned, 2);
	});

	it("restarts the pass when the checkpointed account no longer exists", async () => {
		for (let i = 0; i < 3; i++) await stored(LIST);

		const result = await backfillListIds(deps(), {
			batchSize: 2,
			checkpointStore: {
				load: async () => ({ accountConfigId: "cfg-removed" }),
				save: async () => {},
				clear: async () => {},
			},
		});

		assert.equal(result.scanned, 3);
		assert.equal(result.backfilled, 3);
	});
});
