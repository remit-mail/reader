import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import Database from "better-sqlite3";
import {
	applyMigration,
	shippedTableDdl,
} from "../test-shipped-sqlite-schema.js";

/**
 * The `mailbox.highest_modseq` type correction (reader#73), run against a real
 * database seeded through the pre-migration DDL.
 *
 * A mod-sequence is an unsigned 63-bit value the codebase carries as decimal
 * digits and parses to BigInt, and the cursor stored in this column also takes
 * a non-numeric `"<group>:<uid>"` form. `integer` could represent neither: a
 * column with numeric affinity comes back from better-sqlite3 as a JS number,
 * which above 2^53 rounds to a *different* value that still looks like digits,
 * so a cursor silently over-claims and the mail it stepped over is never
 * fetched.
 *
 * Existing rows hold real cursors, so the conversion has to preserve their
 * exact digits. SQLite keeps the value as a 64-bit integer internally, so the
 * copy into the text column is exact — the rounding only ever happened at the
 * JavaScript boundary.
 */

const seed = (sqlite: Database.Database, path: string, modseq: string): void =>
	void sqlite.exec(
		`INSERT INTO mailbox (
			mailbox_id, account_id, namespace_type, namespace_prefix,
			hierarchy_delimiter, full_path, uid_validity, uid_next,
			highest_modseq, message_count, unseen_count, deleted_count,
			total_size, last_sync_uid, high_water_mark_uid,
			last_message_sync_at, parent_mailbox_id, cursor_state,
			created_at, updated_at
		) VALUES (
			'mb-${path}', 'acc-1', 'personal', '', '/', '${path}', 1, 1,
			${modseq}, 0, 0, 0, 0, 0, 0, 1000, 'None', 'normal', 1000, 1000
		)`,
	);

const readModseq = (sqlite: Database.Database, path: string): unknown =>
	(
		sqlite
			.prepare("SELECT highest_modseq FROM mailbox WHERE full_path = ?")
			.get(path) as { highest_modseq: unknown }
	).highest_modseq;

/** A database at the pre-migration DDL, seeded with the cursors under test. */
const seeded = (): Database.Database => {
	const sqlite = new Database(":memory:");
	sqlite.exec(shippedTableDdl("0000_happy_roland_deschain", "mailbox"));
	seed(sqlite, "INBOX", "900");
	seed(sqlite, "Archive", "9007199254740995");
	seed(sqlite, "Sent", "9223372036854775807");
	return sqlite;
};

describe("mailbox.highest_modseq before the correction (reader#73, sqlite)", () => {
	let sqlite: Database.Database;

	before(() => {
		sqlite = seeded();
	});

	after(() => {
		sqlite.close();
	});

	test("the column reads back a higher cursor than it stores", () => {
		// 2^53 + 3 has no double representation and rounds to 2^53 + 4, still
		// plain digits and still past every check a caller makes. A cursor that
		// reads higher than it was written claims work that was never applied,
		// so the mail it stepped over is never fetched.
		const value = readModseq(sqlite, "Archive");
		assert.equal(typeof value, "number");
		assert.equal(BigInt(String(value)) > 9007199254740995n, true);

		const max = readModseq(sqlite, "Sent");
		assert.equal(BigInt(String(max)) > 9223372036854775807n, true);
	});
});

describe("mailbox.highest_modseq type correction (reader#73, sqlite)", () => {
	let sqlite: Database.Database;

	// A database of its own, migrated in setup: every test here asserts against
	// the post-migration state and none of them mutates the schema, so the suite
	// holds whatever order or concurrency the runner chooses.
	before(() => {
		sqlite = seeded();
		applyMigration(sqlite, "0003_highest_modseq_text");
	});

	after(() => {
		sqlite.close();
	});

	test("converts the column to text", () => {
		const columns = sqlite
			.prepare("PRAGMA table_info(mailbox)")
			.all() as Array<{
			name: string;
			type: string;
		}>;
		const modseq = columns.find((c) => c.name === "highest_modseq");
		assert.equal(modseq?.type.toLowerCase(), "text");
	});

	test("existing cursors survive with their exact digits", () => {
		assert.strictEqual(readModseq(sqlite, "INBOX"), "900");
		assert.strictEqual(readModseq(sqlite, "Archive"), "9007199254740995");
		assert.strictEqual(readModseq(sqlite, "Sent"), "9223372036854775807");
	});

	test("keeps every other mailbox column and its index", () => {
		const rows = sqlite
			.prepare("SELECT full_path, uid_validity, cursor_state FROM mailbox")
			.all() as Array<{
			full_path: string;
			uid_validity: number;
			cursor_state: string;
		}>;
		assert.deepEqual(rows.map((r) => r.full_path).sort(), [
			"Archive",
			"INBOX",
			"Sent",
		]);
		assert.equal(
			rows.every((r) => r.uid_validity === 1 && r.cursor_state === "normal"),
			true,
		);

		const indexes = sqlite
			.prepare("PRAGMA index_list(mailbox)")
			.all() as Array<{
			name: string;
		}>;
		assert.equal(
			indexes.some((i) => i.name === "mailbox_by_account_id"),
			true,
		);
	});

	test("a non-numeric resumable cursor stores and reads back unchanged", () => {
		const own = seeded();
		applyMigration(own, "0003_highest_modseq_text");
		try {
			own.exec(
				"UPDATE mailbox SET highest_modseq = '18446744073709551615:149' WHERE full_path = 'INBOX'",
			);
			assert.strictEqual(readModseq(own, "INBOX"), "18446744073709551615:149");
		} finally {
			own.close();
		}
	});
});
