import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import { backfillSearchText } from "./search-text-backfill.js";
import { eml } from "./test-helpers/fake-imap.js";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	seedMessage,
	silentLog,
	storeBody,
} from "./test-helpers/test-store.js";

const MISSING_BODY = "file:///nonexistent/remit/body.eml";

let store: Store;
let storage: StorageService;
let account: AccountItem;
let inbox: MailboxItem;

beforeEach(async () => {
	store = await openStore();
	storage = store.storage();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
});

afterEach(() => store.close());

const found = async (word: string): Promise<string[]> =>
	(
		await store.threadMessage.searchByDate(
			account.accountConfigId,
			{ query: word },
			{ mailboxIds: new Set([inbox.mailboxId]) },
		)
	).items.map((item) => item.messageId);

const backfill = () =>
	backfillSearchText(
		{ messageService: store.message, storageService: storage },
		silentLog,
	);

describe("backfillSearchText", () => {
	it("makes a body stored before search text findable by a word in it", async () => {
		const { message } = await seedMessage(store, account, inbox, 1);
		await storeBody(
			store,
			storage,
			account,
			message.messageId,
			eml(
				{ From: "Ada <ada@example.com>", Subject: "Garden" },
				"the zygomorphic flower opened",
			),
		);
		assert.deepEqual(await found("zygomorphic"), []);

		assert.deepEqual(await backfill(), { indexed: 1, skipped: 0 });

		assert.deepEqual(await found("zygomorphic"), [message.messageId]);
	});

	it("skips a message whose stored body is gone, leaving it for the next pass", async () => {
		const { message } = await seedMessage(store, account, inbox, 1, {
			message: { bodyStorageKey: MISSING_BODY },
		});

		assert.deepEqual(await backfill(), { indexed: 0, skipped: 1 });

		assert.deepEqual(
			(await store.message.listMissingSearchText("", 10)).map(
				(row) => row.messageId,
			),
			[message.messageId],
		);
	});
});
