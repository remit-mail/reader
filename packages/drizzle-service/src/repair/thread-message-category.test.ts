import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { createTestDb } from "../test-db.js";
import {
	type RepairSqlClient,
	repairStatement,
	repairThreadMessageCategory,
} from "./thread-message-category.js";
import { describeRepairContract } from "./thread-message-category-contract.js";

const { pool, close } = await createTestDb();

after(async () => {
	await close();
});

const client: RepairSqlClient = {
	dialect: "postgres",
	all: async (sql) => (await pool.query(sql)).rows,
	run: async (sql) => (await pool.query(sql)).rowCount ?? 0,
};

const truncate = async (): Promise<void> => {
	await pool.query("DELETE FROM thread_message");
	await pool.query("DELETE FROM message");
};

describeRepairContract("postgres", async () => ({
	client,
	reset: truncate,
	close: async () => undefined,
}));

// Postgres is where a mid-sync run can actually go wrong. Under READ COMMITTED
// an UPDATE that meets a row a concurrent transaction just changed re-evaluates
// its WHERE clause against the new version of that row, but keeps reading other
// tables at its original snapshot — so without the `updated_at` guard the repair
// could write a pre-classification value over the one body-sync just wrote. This
// drives that exact interleaving with two connections: the row passes the WHERE
// clause at statement start, and only the re-check against the committed new
// version can exclude it.
describe("thread_message.category repair — a writer commits mid-statement", () => {
	test("the concurrent writer's value stands and the rest is still repaired", async () => {
		await truncate();

		const seed = async (messageId: string, category: string): Promise<void> => {
			await pool.query(
				`INSERT INTO message (
					message_id, mailbox_id, uid, sequence_number, rfc822_size, internal_date,
					envelope_id, root_body_part_id, category, created_at, updated_at
				) VALUES ($1, 'mbx-inbox', 1, 1, 100, 0, 'env-1', 'part-1', $2, 0, 0)`,
				[messageId, category],
			);
			await pool.query(
				`INSERT INTO thread_message (
					thread_message_id, thread_id, message_id, account_config_id, mailbox_id,
					uid, reference_order, internal_date, sent_date, is_read, has_attachment,
					has_stars, is_deleted, category, created_at, updated_at
				) VALUES ($1, 'thr-1', $1, 'acct-1', 'mbx-inbox', 1, 0, 0, 0,
					false, false, false, false, 'uncategorized', 0, 1000)`,
				[messageId],
			);
		};

		await seed("msg-raced", "newsletter");
		await seed("msg-quiet", "newsletter");

		const writer = await pool.connect();
		try {
			await writer.query("BEGIN");
			// A body-sync denormalize: it writes the classification onto the row and
			// stamps updated_at, and its stamp falls after the repair statement
			// begins — which is what any write during the repair's scan produces.
			await writer.query(
				"UPDATE thread_message SET category = 'social', updated_at = $1 WHERE thread_message_id = 'msg-raced'",
				[Date.now() + 5_000],
			);

			const repairing = repairThreadMessageCategory(client);
			// The writer's own connection waits, so the repair reaches the row lock
			// before the commit releases it.
			await writer.query("SELECT pg_sleep(0.25)");
			await writer.query("COMMIT");

			assert.equal((await repairing).rowsWritten, 1);
		} finally {
			writer.release();
		}

		const { rows } = await pool.query<{
			thread_message_id: string;
			category: string;
		}>(
			"SELECT thread_message_id, category FROM thread_message ORDER BY thread_message_id",
		);
		assert.deepEqual(rows, [
			{ thread_message_id: "msg-quiet", category: "newsletter" },
			{ thread_message_id: "msg-raced", category: "social" },
		]);
	});

	test("only the clock expression differs between the dialects", () => {
		const postgres = repairStatement("postgres");
		const sqlite = repairStatement("sqlite");
		assert.ok(postgres.includes("EXTRACT(EPOCH FROM now())"));
		assert.ok(sqlite.includes("unixepoch('subsec')"));
		assert.equal(
			postgres.replace(/CAST\(EXTRACT.*$/, ""),
			sqlite.replace(/CAST\(unixepoch.*$/, ""),
		);
	});
});
