import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import {
	applyMigration,
	migrationJournal,
} from "./test-shipped-sqlite-schema.js";

/**
 * `sync_status` becomes NOT NULL, and on a real install almost every row is
 * NULL: the sweep's insert is the only create path that omitted it, and the
 * sweep is what discovers a folder in the first place.
 *
 * drizzle-kit does not emit data migrations, and SQLite cannot alter
 * nullability, so the schema change is a copy-and-swap whose `INSERT … SELECT`
 * would violate the new constraint on every one of those rows. Because drizzle
 * runs a folder's whole pending set inside one `BEGIN`/`COMMIT`, that failure
 * rolls the entities set back and the migrate one-shot that gates all six
 * services never completes.
 *
 * So the pair is proven here in the order the migrator runs it, against the
 * data it will actually meet.
 */
const BACKFILL = "0026_mailbox_sync_status_backfill";
const SCHEMA_CHANGE = "0027_mailbox_sync_status_total";

const atPredecessor = (): Database.Database => {
	const sqlite = new Database(":memory:");
	for (const entry of migrationJournal()) {
		if (entry.tag === BACKFILL) return sqlite;
		applyMigration(sqlite, entry.tag);
	}
	throw new Error(`${BACKFILL} is not in the journal`);
};

const seed = (
	sqlite: Database.Database,
	rows: Array<{ mailboxId: string; syncStatus: string | null }>,
): void => {
	const insert = sqlite.prepare(
		`INSERT INTO mailbox (
			mailbox_id, account_id, namespace_type, namespace_prefix,
			hierarchy_delimiter, full_path, uid_validity, uid_next, highest_modseq,
			message_count, unseen_count, deleted_count, total_size, last_sync_uid,
			high_water_mark_uid, last_message_sync_at, parent_mailbox_id,
			sync_status, cursor_state, created_at, updated_at
		) VALUES (?, 'acct', 'personal', '', '/', ?, 1, 1, '0', 0, 0, 0, 0, 0, 0, 0,
			'None', ?, 'normal', 0, 0)`,
	);
	for (const row of rows) {
		insert.run(row.mailboxId, `Folder/${row.mailboxId}`, row.syncStatus);
	}
};

describe("mailbox sync_status becomes total", () => {
	test("the backfill runs first, so the rebuild sees no NULLs", () => {
		const sqlite = atPredecessor();
		seed(sqlite, [
			{ mailboxId: "swept-1", syncStatus: null },
			{ mailboxId: "swept-2", syncStatus: null },
			{ mailboxId: "created", syncStatus: "pending" },
			{ mailboxId: "failed", syncStatus: "failed" },
		]);

		applyMigration(sqlite, BACKFILL);
		applyMigration(sqlite, SCHEMA_CHANGE);

		const rows = sqlite
			.prepare(
				"SELECT mailbox_id, sync_status FROM mailbox ORDER BY mailbox_id",
			)
			.all() as Array<{ mailbox_id: string; sync_status: string }>;

		assert.deepEqual(rows, [
			{ mailbox_id: "created", sync_status: "pending" },
			{ mailbox_id: "failed", sync_status: "failed" },
			{ mailbox_id: "swept-1", sync_status: "synced" },
			{ mailbox_id: "swept-2", sync_status: "synced" },
		]);
		sqlite.close();
	});

	test("the rebuild is refused without the backfill ahead of it", () => {
		// The failure this ordering exists to prevent, made visible: without the
		// backfill the copy-and-swap cannot insert a NULL into the new column.
		const sqlite = atPredecessor();
		seed(sqlite, [{ mailboxId: "swept-1", syncStatus: null }]);

		assert.throws(
			() => applyMigration(sqlite, SCHEMA_CHANGE),
			/NOT NULL constraint failed/,
		);
		sqlite.close();
	});

	test("the rebuild keeps the account index and the new column", () => {
		const sqlite = atPredecessor();
		applyMigration(sqlite, BACKFILL);
		applyMigration(sqlite, SCHEMA_CHANGE);
		applyMigration(sqlite, "0028_mailbox_pending_path");

		const columns = (
			sqlite.prepare("PRAGMA table_info(mailbox)").all() as Array<{
				name: string;
			}>
		).map((column) => column.name);
		assert.equal(columns.includes("pending_path"), true);
		assert.equal(columns.includes("old_path"), false);

		const indexes = (
			sqlite.prepare("PRAGMA index_list(mailbox)").all() as Array<{
				name: string;
			}>
		).map((index) => index.name);
		assert.equal(indexes.includes("mailbox_by_account_id"), true);
		sqlite.close();
	});
});
