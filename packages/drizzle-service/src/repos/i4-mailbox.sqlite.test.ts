import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mailboxTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { MailboxRepo } from "./i4-mailbox.js";

/**
 * The `mailbox` DDL as it actually ships, read from the committed migration
 * rather than pushed from the drizzle table objects.
 *
 * The two disagree: the table object declares `highest_modseq` as text, the
 * shipped migration still declares it `integer` (reader#73). Every other
 * SQLite test in this package runs against the pushed shape, so none of them
 * has ever exercised the one deployments run on — and SQLite hands a column
 * with numeric affinity back as a number regardless of what the schema says.
 * Reading the committed file keeps this test honest as the migration changes.
 */
const shippedMailboxDdl = (): string => {
	const sql = readFileSync(
		new URL(
			"../../../../deploy/vps/migrations-sqlite/entities/0000_happy_roland_deschain.sql",
			import.meta.url,
		),
		"utf8",
	);
	const match = sql.match(/CREATE TABLE `mailbox` \([\s\S]*?\n\);/);
	if (!match)
		throw new Error("mailbox DDL not found in the committed migration");
	return match[0];
};

function makeMailboxInput(accountId: string, fullPath = "INBOX") {
	return {
		accountId,
		namespaceType: "personal" as const,
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		fullPath,
		uidValidity: 1,
		uidNext: 1,
		highestModseq: "0",
		messageCount: 0,
		unseenCount: 0,
		deletedCount: 0,
		totalSize: 0,
		lastSyncUid: 0,
		highWaterMarkUid: 0,
		lastMessageSyncAt: Date.now(),
	};
}

describe("MailboxRepo (sqlite)", () => {
	let close: () => Promise<void>;
	let repo: MailboxRepo;

	before(async () => {
		const testDb = await createSqliteTestDb({ mailbox: mailboxTable });
		close = testDb.close;
		repo = new MailboxRepo(testDb.db as never);
	});

	after(async () => {
		await close();
	});

	test("highestModseq round-trips a value above 2^53 without loss (reader#9)", async () => {
		const accountId = randomUUID();
		const modseq = "18446744073709551615";

		const created = await repo.create({
			...makeMailboxInput(accountId),
			highestModseq: modseq,
		});
		assert.equal(created.highestModseq, modseq);

		const fetched = await repo.get(accountId, created.mailboxId);
		assert.equal(fetched.highestModseq, modseq);
		assert.equal(BigInt(fetched.highestModseq) > 2n ** 53n, true);

		const updated = await repo.update(accountId, created.mailboxId, {
			highestModseq: "9007199254740993",
		});
		assert.equal(updated.highestModseq, "9007199254740993");
		const reread = await repo.get(accountId, created.mailboxId);
		assert.equal(reread.highestModseq, "9007199254740993");
	});
});

describe("MailboxRepo (sqlite, shipped column shape)", () => {
	let close: () => Promise<void>;
	let repo: MailboxRepo;

	before(async () => {
		const sqlite = new Database(":memory:");
		sqlite.exec(shippedMailboxDdl());
		const db = drizzle(sqlite, { schema: { mailbox: mailboxTable } });
		repo = new MailboxRepo(db as never);
		close = async () => {
			sqlite.close();
		};
	});

	after(async () => {
		await close();
	});

	test("reads the sync cursor back as a string, whatever the column stores", async () => {
		// A plain-digit cursor lands in a column with numeric affinity and comes
		// back a number. Callers compare the value they wrote against the value
		// they read — `"900" === 900` is false — so an unnormalised read makes a
		// stalled cursor undetectable.
		const accountId = randomUUID();
		const created = await repo.create({
			...makeMailboxInput(accountId),
			highestModseq: "900",
		});

		assert.strictEqual(created.highestModseq, "900");

		const fetched = await repo.get(accountId, created.mailboxId);
		assert.strictEqual(fetched.highestModseq, "900");
		assert.strictEqual(fetched.highestModseq === "900", true);
	});

	test("keeps a resumable cursor intact through the same column", async () => {
		const accountId = randomUUID();
		const created = await repo.create({
			...makeMailboxInput(accountId, "Archive"),
			highestModseq: "900:149",
		});

		const fetched = await repo.get(accountId, created.mailboxId);
		assert.strictEqual(fetched.highestModseq, "900:149");
	});
});
