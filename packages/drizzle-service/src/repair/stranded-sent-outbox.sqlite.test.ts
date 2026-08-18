/**
 * The repair against the shape a deployment actually runs: the committed
 * `CREATE TABLE` block, not a schema pushed from the drizzle table objects.
 *
 * What it has to hold on a live database: a message whose filing is still in
 * flight is left alone, a stranded one becomes visible, no row is removed, and
 * a second run writes nothing.
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import Database from "better-sqlite3";
import { shippedTableDdl } from "../test-shipped-sqlite-schema.js";
import {
	STRANDED_AFTER_MILLIS,
	type StrandedSentRepairClient,
	sweepStrandedSentOutbox,
} from "./stranded-sent-outbox.js";

const clientOver = (sqlite: Database.Database): StrandedSentRepairClient => ({
	all: async (sql, params) => sqlite.prepare(sql).all(...params),
	run: async (sql, params) => sqlite.prepare(sql).run(...params).changes,
});

interface Row {
	status: string;
	last_error: string | null;
}

describe("outbox rows stranded at sent", () => {
	let sqlite: Database.Database;

	const insert = (
		outboxMessageId: string,
		status: string,
		sentAt: number,
	): void => {
		sqlite
			.prepare(
				`INSERT INTO outbox_message (
					outbox_message_id, account_id, account_config_id, from_address,
					to_addresses, cc_addresses, bcc_addresses, "references",
					message_id_value, status, sent_at, created_at, updated_at
				) VALUES (?, 'acc', 'cfg', 'me@example.com', '["you@example.com"]',
					'[]', '[]', '[]', 'mid@example.com', ?, ?, ?, ?)`,
			)
			.run(outboxMessageId, status, sentAt, sentAt, sentAt);
	};

	const read = (outboxMessageId: string): Row =>
		sqlite
			.prepare(
				"SELECT status, last_error FROM outbox_message WHERE outbox_message_id = ?",
			)
			.get(outboxMessageId) as Row;

	before(() => {
		sqlite = new Database(":memory:");
		sqlite.exec(
			shippedTableDdl("0000_happy_roland_deschain", "outbox_message"),
		);
	});

	after(() => {
		sqlite.close();
	});

	test("makes a stranded sent message visible again", async () => {
		const stranded = Date.now() - STRANDED_AFTER_MILLIS - 1000;
		insert("stranded", "sent", stranded);

		const report = await sweepStrandedSentOutbox(clientOver(sqlite), "repair");

		assert.equal(report.stranded, 1);
		assert.equal(report.settled, 1);
		const row = read("stranded");
		assert.equal(row.status, "unfiled");
		assert.match(String(row.last_error), /not filed/);
	});

	test("a second run writes nothing", async () => {
		const report = await sweepStrandedSentOutbox(clientOver(sqlite), "repair");

		assert.equal(report.stranded, 0);
		assert.equal(report.settled, 0);
	});

	test("leaves a filing that is still in flight alone", async () => {
		insert("in-flight", "sent", Date.now());

		const report = await sweepStrandedSentOutbox(clientOver(sqlite), "repair");

		assert.equal(report.stranded, 0);
		assert.equal(read("in-flight").status, "sent");
	});

	test("touches no other status", async () => {
		const old = Date.now() - STRANDED_AFTER_MILLIS - 1000;
		insert("a-draft", "draft", old);
		insert("a-failure", "failed", old);

		await sweepStrandedSentOutbox(clientOver(sqlite), "repair");

		assert.equal(read("a-draft").status, "draft");
		assert.equal(read("a-failure").status, "failed");
	});

	test("check mode reports what it would do and writes nothing", async () => {
		insert("also-stranded", "sent", Date.now() - STRANDED_AFTER_MILLIS - 1000);

		const report = await sweepStrandedSentOutbox(clientOver(sqlite), "check");

		assert.equal(report.stranded, 1);
		assert.equal(report.settled, 0);
		assert.equal(read("also-stranded").status, "sent");
	});
});
