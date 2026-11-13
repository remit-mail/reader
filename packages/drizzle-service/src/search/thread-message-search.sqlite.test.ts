import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreateThreadMessageInput } from "@remit/data-ports";
import { NODE_SQLITE_LIMITS } from "../bound-parameters.js";
import { syncStore } from "../databases.js";
import { messageObjectsInMemory } from "../repos/message-objects.js";
import { messageSearchTextTable } from "../schema/message-data.js";
import { openTestSqlite } from "../sqlite.js";
import { createSqliteRepositories } from "../sqlite-repositories.js";
import { applyMigrationSet } from "../test-shipped-sqlite-schema.js";
import {
	SearchIndex,
	threadMessageSearchTable,
} from "./thread-message-search.js";

// The search index lives in its own database (#1420): a thread message written
// to the mail database is findable once the search write that follows it has
// run, and a search never reads the mail database's text to find it.

const ACCOUNT = "acct-search";
const MAILBOX = "mbx-search";

const input = (
	overrides: Partial<CreateThreadMessageInput>,
): CreateThreadMessageInput => ({
	accountConfigId: ACCOUNT,
	threadId: `t-${Math.random().toString(36).slice(2)}`,
	messageId: `m-${Math.random().toString(36).slice(2)}`,
	mailboxId: MAILBOX,
	uid: 1,
	referenceOrder: 0,
	internalDate: 0,
	sentDate: 0,
	isRead: false,
	isDeleted: false,
	hasAttachment: false,
	hasStars: false,
	...overrides,
});

const open = (set: "mail" | "search") => {
	const handle = openTestSqlite<Record<string, unknown>>({});
	applyMigrationSet(handle, set);
	return handle;
};

describe("the thread-message search index in its own database", () => {
	const mail = open("mail");
	const search = open("search");
	const index = new SearchIndex(
		mail.db,
		syncStore(search.db, NODE_SQLITE_LIMITS),
	);
	const repo = createSqliteRepositories(
		{
			app: mail.db,
			mail: mail.db,
			search: search.db,
		},
		NODE_SQLITE_LIMITS,
		messageObjectsInMemory(),
	).threadMessage;

	const found = async (query: string): Promise<string[]> =>
		(await repo.searchByMailboxWindow(ACCOUNT, MAILBOX, { query })).items.map(
			(item) => item.threadMessageId,
		);

	const documents = (): number =>
		(
			search.sqlite
				.prepare("SELECT count(*) AS n FROM thread_message_fts")
				.get() as { n: number }
		).n;

	before(() => {
		assert.equal(
			(
				mail.sqlite
					.prepare(
						"SELECT count(*) AS n FROM sqlite_master WHERE name = 'thread_message_fts'",
					)
					.get() as { n: number }
			).n,
			0,
			"the mail database carries no search table",
		);
	});

	after(() => {
		mail.close();
		search.close();
	});

	test("finds a message by subject, sender and body once it is written", async () => {
		const message = input({
			subject: "Quarterly invoice",
			fromName: "Ada Lovelace",
			fromEmail: "ada@example.test",
		});
		await mail.db.insert(messageSearchTextTable).values({
			messageId: message.messageId,
			text: "the analytical engine",
			createdAt: 0,
			updatedAt: 0,
		});
		const created = await repo.create(message);

		assert.deepEqual(await found("invoice"), [created.threadMessageId]);
		assert.deepEqual(await found("lovelace"), [created.threadMessageId]);
		assert.deepEqual(await found("analytical"), [created.threadMessageId]);
		assert.deepEqual(await found("nowhere"), []);
	});

	test("matches words by prefix, folding case and diacritics", async () => {
		const created = await repo.create(
			input({
				subject: "Crème brûlée recipe",
				fromName: "Matthijs van Henten",
			}),
		);

		assert.deepEqual(await found("matt"), [created.threadMessageId]);
		assert.deepEqual(await found("CREME brul"), [created.threadMessageId]);
		assert.deepEqual(await found("thijs"), []);
	});

	test("follows a rewritten subject and drops the old one", async () => {
		const created = await repo.create(input({ subject: "Draft agenda" }));
		await repo.update(ACCOUNT, created.threadMessageId, {
			subject: "Final minutes",
		});

		assert.deepEqual(await found("agenda"), []);
		assert.deepEqual(await found("minutes"), [created.threadMessageId]);
	});

	test("forgets a deleted message", async () => {
		const created = await repo.create(input({ subject: "Ephemeral notice" }));
		const before = documents();
		await repo.delete(ACCOUNT, created.threadMessageId);

		assert.deepEqual(await found("ephemeral"), []);
		assert.equal(documents(), before - 1);
	});

	test("rebuilds every document from the mail database", async () => {
		const created = await repo.create(input({ subject: "Rebuilt receipt" }));
		await search.db.delete(threadMessageSearchTable);
		assert.equal(await index.needsRebuild(), true);
		assert.deepEqual(await found("receipt"), []);

		await index.rebuild();

		assert.equal(await index.needsRebuild(), false);
		assert.deepEqual(await found("receipt"), [created.threadMessageId]);
	});

	test("rebuilds while a live writer indexes a message the rebuild has yet to reach", async () => {
		const created = await repo.create(input({ subject: "Raced reminder" }));
		const store = syncStore(search.db, NODE_SQLITE_LIMITS);
		let raced = false;
		const migrator = new SearchIndex(mail.db, {
			...store,
			batch: async (items) => {
				if (!raced) {
					raced = true;
					await index.sync([created.threadMessageId]);
				}
				return store.batch(items);
			},
		});

		await migrator.rebuild();
		await migrator.rebuild();

		assert.equal(raced, true);
		assert.equal(await index.needsRebuild(), false);
		assert.deepEqual(await found("reminder"), [created.threadMessageId]);
	});

	test("matches the body text past the snippet, through a rewrite and a rebuild", async () => {
		const created = await repo.create(
			input({ subject: "Long letter", snippet: "Dear reader, a preview" }),
		);
		const text = `Dear reader, a preview ${"filler words ".repeat(200)}zygomorphic`;
		await mail.db.insert(messageSearchTextTable).values({
			messageId: created.messageId,
			text,
			createdAt: 0,
			updatedAt: 0,
		});
		await index.sync([created.threadMessageId]);
		assert.deepEqual(await found("zygomorphic"), [created.threadMessageId]);

		await repo.update(ACCOUNT, created.threadMessageId, {
			subject: "Longer letter",
		});
		assert.deepEqual(await found("zygomorphic"), [created.threadMessageId]);

		await index.rebuild();
		assert.deepEqual(await found("zygomorphic"), [created.threadMessageId]);
	});
});
