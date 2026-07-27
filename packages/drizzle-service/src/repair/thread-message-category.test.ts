import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
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

// Postgres is where a mid-sync run can go wrong, and the two interleavings have
// opposite outcomes — so each is driven with two real connections rather than
// argued about. Under READ COMMITTED an UPDATE that meets a row a concurrent
// transaction just changed re-evaluates its WHERE clause against the new version
// of that row, but keeps reading other tables at its original snapshot.
//
// Both cases need a *re*-classification to be observable at all: `message` moving
// from one decided category to another. `backfillClassification` cannot do that
// (it returns early once the category is decided), but the primary path is
// re-enterable — `if (message.bodyStorageKey && !force)`, where `force` is the
// read-miss re-arm cue — and a forced re-fetch decides differently across a
// release that changed the classifier. So the uncovered case below is
// effectively unreachable rather than impossible. The seeds are synthetic
// because reproducing it otherwise would mean changing the classifier.
describe("thread_message.category repair — a writer racing the statement", () => {
	const insertMessage = async (
		messageId: string,
		category: string,
	): Promise<void> => {
		await pool.query(
			`INSERT INTO message (
				message_id, mailbox_id, uid, sequence_number, rfc822_size, internal_date,
				envelope_id, root_body_part_id, category, created_at, updated_at
			) VALUES ($1, 'mbx-inbox', 1, 1, 100, 0, 'env-1', 'part-1', $2, 0, 0)`,
			[messageId, category],
		);
	};

	const insertRow = async (
		messageId: string,
		category: string,
	): Promise<void> => {
		await pool.query(
			`INSERT INTO thread_message (
				thread_message_id, thread_id, message_id, account_config_id, mailbox_id,
				uid, reference_order, internal_date, sent_date, is_read, has_attachment,
				has_stars, is_deleted, category, created_at, updated_at
			) VALUES ($1, 'thr-1', $1, 'acct-1', 'mbx-inbox', 1, 0, 0, 0,
				false, false, false, false, $2, 0, 1000)`,
			[messageId, category],
		);
	};

	// A body-sync denormalize, faithful to the shipped order (#326): the row
	// first, the message second, both stamped with the wall clock at write time.
	const reclassify = async (
		connection: {
			query: (sql: string, values?: unknown[]) => Promise<unknown>;
		},
		messageId: string,
		category: string,
	): Promise<void> => {
		await connection.query(
			"UPDATE thread_message SET category = $2, updated_at = $3 WHERE thread_message_id = $1",
			[messageId, category, Date.now()],
		);
		await connection.query(
			"UPDATE message SET category = $2, updated_at = $3 WHERE message_id = $1",
			[messageId, category, Date.now()],
		);
	};

	const categories = async (): Promise<Record<string, string>> => {
		const { rows } = await pool.query<{
			thread_message_id: string;
			category: string;
		}>("SELECT thread_message_id, category FROM thread_message");
		return Object.fromEntries(
			rows.map((row) => [row.thread_message_id, row.category]),
		);
	};

	before(truncate);

	// The case the guard covers: the writer's transaction begins after the
	// statement, so its stamp is beyond the statement's clock and the re-check
	// against the committed row excludes it. The repair is held on an unrelated
	// row lock for the duration, which is what puts the writer inside the
	// statement's window without touching its stamp.
	test("a writer that begins after the statement keeps its value", async () => {
		await truncate();
		await insertMessage("aaa-blocker", "newsletter");
		await insertRow("aaa-blocker", "uncategorized");
		await insertMessage("bbb-raced", "newsletter");
		await insertRow("bbb-raced", "uncategorized");

		const holder = await pool.connect();
		const writer = await pool.connect();
		try {
			await holder.query("BEGIN");
			await holder.query(
				"UPDATE thread_message SET updated_at = 1001 WHERE thread_message_id = 'aaa-blocker'",
			);

			const repairing = repairThreadMessageCategory(client);
			// The repair reaches the blocker row — inserted first, so first in the
			// sequential scan — and waits there. The sleep is on the holder's own
			// connection, so nothing polls.
			await holder.query("SELECT pg_sleep(0.5)");

			await writer.query("BEGIN");
			await reclassify(writer, "bbb-raced", "marketing");
			await writer.query("COMMIT");

			await holder.query("COMMIT");

			// Only the blocker. A 2 here means the repair finished before the writer
			// began, so the interleaving this test is named for did not happen.
			assert.equal((await repairing).rowsWritten, 1);
		} finally {
			holder.release();
			writer.release();
		}

		assert.deepEqual(await categories(), {
			"aaa-blocker": "newsletter",
			"bbb-raced": "marketing",
		});
	});

	// The live mid-sync case, and it is safe: a writer whose transaction began
	// before the statement, doing what body-sync actually does — filling in the
	// copy of a category the message already holds. The repair blocks on the row,
	// re-checks against the committed version, finds it now agrees, and writes
	// nothing. This is the interleaving D16's safety argument rests on.
	test("a concurrent denormalize of the same row leaves it correct", async () => {
		await truncate();
		await insertMessage("ddd-catchup", "newsletter");
		await insertRow("ddd-catchup", "uncategorized");

		const writer = await pool.connect();
		try {
			await writer.query("BEGIN");
			await writer.query(
				"UPDATE thread_message SET category = 'newsletter', updated_at = $1 WHERE thread_message_id = 'ddd-catchup'",
				[Date.now()],
			);

			const repairing = repairThreadMessageCategory(client);
			await writer.query("SELECT pg_sleep(0.5)");
			await writer.query("COMMIT");

			assert.equal((await repairing).rowsWritten, 0);
		} finally {
			writer.release();
		}

		assert.deepEqual(await categories(), { "ddd-catchup": "newsletter" });
	});

	// The known limit, pinned so it cannot silently widen. Reaching it needs four
	// things at once: an unrepaired `behind` row, a writer whose transaction began
	// before the statement, that writer's row write committing before the statement
	// while its message write commits after, and that writer moving
	// message.category from one decided value to a different one. Only a forced
	// re-fetch across a classifier change does the fourth, which makes this
	// effectively unreachable rather than impossible; the seed is synthetic and the
	// assertion records the loss rather than endorsing it. If this test ever fails,
	// the guard got stronger and D16 and the module header should say so.
	test("a writer that began before the statement is outside the guard", async () => {
		await truncate();
		await insertMessage("ccc-reclass", "newsletter");
		await insertRow("ccc-reclass", "uncategorized");

		const writer = await pool.connect();
		try {
			await writer.query("BEGIN");
			await reclassify(writer, "ccc-reclass", "marketing");

			const repairing = repairThreadMessageCategory(client);
			await writer.query("SELECT pg_sleep(0.5)");
			await writer.query("COMMIT");

			assert.equal((await repairing).rowsWritten, 1);
		} finally {
			writer.release();
		}

		assert.deepEqual(await categories(), { "ccc-reclass": "newsletter" });
		const { rows } = await pool.query<{ category: string }>(
			"SELECT category FROM message WHERE message_id = 'ccc-reclass'",
		);
		assert.deepEqual(rows, [{ category: "marketing" }]);
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
