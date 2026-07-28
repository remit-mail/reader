import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import Database from "better-sqlite3";
import { messageTable } from "../schema/message-data.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import {
	checkThreadMessageCategory,
	type RepairSqlClient,
	repairStatement,
} from "./thread-message-category.js";
import { describeRepairContract } from "./thread-message-category-contract.js";

const sqliteClient = (sqlite: Database.Database): RepairSqlClient => ({
	all: async (sql) => sqlite.prepare(sql).all(),
	run: async (sql) => sqlite.prepare(sql).run().changes,
});

// The repair against a real better-sqlite3 database — the engine every self-host
// instance runs, and the one whose `unixepoch()` and single-writer serialization
// the statement leans on.
describeRepairContract("sqlite", async () => {
	const { sqlite, close } = await createSqliteTestDb({
		message: messageTable,
		threadMessage: threadMessageTable,
	});

	return {
		client: sqliteClient(sqlite),
		reset: async () => {
			sqlite.exec("DELETE FROM thread_message");
			sqlite.exec("DELETE FROM message");
		},
		close,
	};
});

// Why the repair is skipped when the check found nothing: SQLite takes its
// exclusive write lock when the UPDATE begins, before it can know the WHERE
// matches nothing. Without the skip, every boot of a healthy instance would
// contend for that lock, and a contended boot fails the whole migration — which
// holds all six gated services down.
describe("thread_message.category repair — SQLite's write lock", () => {
	let dir: string;
	let file: string;
	let reader: Database.Database;
	let writer: Database.Database;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), "remit-repair-lock-"));
		file = join(dir, "remit.db");
		const { sqlite, close } = await createSqliteTestDb(
			{ message: messageTable, threadMessage: threadMessageTable },
			{ filename: file },
		);
		sqlite.pragma("journal_mode = WAL");
		await close();

		// 200 ms rather than the migrator's busy_timeout of 5000: the point is that
		// the lock is wanted at all, and waiting five seconds to prove it is waste.
		reader = new Database(file, { timeout: 200 });
		reader.pragma("journal_mode = WAL");
		writer = new Database(file);
	});

	after(() => {
		reader.close();
		writer.close();
		rmSync(dir, { recursive: true, force: true });
	});

	test("the check reads while another connection holds the write lock", async () => {
		writer.exec("BEGIN IMMEDIATE");
		try {
			const report = await checkThreadMessageCategory(sqliteClient(reader));
			assert.equal(report.rows, 0);
			assert.equal(report.repairable, 0);
		} finally {
			writer.exec("ROLLBACK");
		}
	});

	test("the statement still wants the lock with nothing to repair", async () => {
		writer.exec("BEGIN IMMEDIATE");
		try {
			assert.throws(
				() => reader.prepare(repairStatement()).run(),
				(error: unknown) =>
					error instanceof Error &&
					"code" in error &&
					error.code === "SQLITE_BUSY",
			);
		} finally {
			writer.exec("ROLLBACK");
		}
	});
});
