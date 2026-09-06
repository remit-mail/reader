import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import {
	applyMigration,
	migrationJournal,
} from "./test-shipped-sqlite-schema.js";

/**
 * The data migration that clears the `message.created` backlog (reader#1063),
 * against a database that already holds those rows.
 *
 * Every other outbox test starts from an empty table, so the case that matters
 * — an instance upgrading with 30,906 undrained rows the drain filters out and
 * the column's type no longer admits — is only reachable by running the shipped
 * migrations over a table populated at the point the upgrade finds it.
 */

const CLEANUP_TAG = "0022_drop_message_created_outbox";

const seed = (sqlite: Database.Database, event: string, id: string): void => {
	sqlite
		.prepare(
			`INSERT INTO outbox (id, message_id, event, payload, created_at)
			 VALUES (?, ?, ?, ?, ?)`,
		)
		.run(id, `message-${id}`, event, JSON.stringify({ messageId: id }), 1);
};

const unprocessed = (sqlite: Database.Database): string[] =>
	(
		sqlite
			.prepare(
				"SELECT event FROM outbox WHERE processed_at IS NULL ORDER BY event",
			)
			.all() as Array<{ event: string }>
	).map((row) => row.event);

const upgradedDatabase = (): Database.Database => {
	const entries = [...migrationJournal()].sort(
		(left, right) => left.idx - right.idx,
	);
	const cleanup = entries.findIndex((entry) => entry.tag === CLEANUP_TAG);
	assert.notEqual(cleanup, -1, `${CLEANUP_TAG} is not in the journal`);

	const sqlite = new Database(":memory:");
	for (const entry of entries.slice(0, cleanup)) {
		applyMigration(sqlite, entry.tag);
	}

	seed(sqlite, "message.created", "created-1");
	seed(sqlite, "message.created", "created-2");
	seed(sqlite, "message.body_synced", "synced-1");
	seed(sqlite, "message.moved", "moved-1");

	for (const entry of entries.slice(cleanup)) {
		applyMigration(sqlite, entry.tag);
	}
	return sqlite;
};

describe("the message.created outbox cleanup", () => {
	test("clears the rows an upgrading instance already has", () => {
		const sqlite = upgradedDatabase();

		const left = sqlite
			.prepare("SELECT COUNT(*) AS n FROM outbox WHERE event = ?")
			.get("message.created") as { n: number };

		assert.equal(left.n, 0);
		sqlite.close();
	});

	test("leaves the drained kinds alone", () => {
		const sqlite = upgradedDatabase();

		assert.deepEqual(unprocessed(sqlite), [
			"message.body_synced",
			"message.moved",
		]);
		sqlite.close();
	});
});
