/**
 * The repair against the shape a deployment actually runs: the committed
 * `CREATE TABLE` block, not a schema pushed from the drizzle table objects.
 *
 * What it has to hold on a live database: a message whose filing is still in
 * flight is left alone, one that was never filed becomes visible, one that was
 * filed loses the row that outlived its delete, and a second run writes nothing.
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import Database from "better-sqlite3";
import {
	applyMigration,
	shippedTableDdl,
} from "../test-shipped-sqlite-schema.js";
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
		appendedUid = 0,
	): void => {
		sqlite
			.prepare(
				`INSERT INTO outbox_message (
					outbox_message_id, account_id, account_config_id, from_address,
					to_addresses, cc_addresses, bcc_addresses, "references",
					message_id_value, status, sent_at, appended_uid, created_at, updated_at
				) VALUES (?, 'acc', 'cfg', 'me@example.com', '["you@example.com"]',
					'[]', '[]', '[]', 'mid@example.com', ?, ?, ?, ?, ?)`,
			)
			.run(outboxMessageId, status, sentAt, appendedUid, sentAt, sentAt);
	};

	const attach = (outboxMessageId: string): void => {
		sqlite
			.prepare(
				`INSERT INTO outbox_attachment (
					outbox_attachment_id, outbox_message_id, account_id,
					account_config_id, filename, content_type, size_bytes, state,
					storage_key, reservation_expires_at, created_at, updated_at
				) VALUES (?, ?, 'acc', 'cfg', 'q.pdf', 'application/pdf', 12,
					'Stored', 'k', 0, 0, 0)`,
			)
			.run(`att-${outboxMessageId}`, outboxMessageId);
	};

	const read = (outboxMessageId: string): Row | undefined =>
		sqlite
			.prepare(
				"SELECT status, last_error FROM outbox_message WHERE outbox_message_id = ?",
			)
			.get(outboxMessageId) as Row | undefined;

	const attachmentCount = (outboxMessageId: string): number =>
		(
			sqlite
				.prepare(
					"SELECT count(*) AS n FROM outbox_attachment WHERE outbox_message_id = ?",
				)
				.get(outboxMessageId) as { n: number }
		).n;

	before(() => {
		sqlite = new Database(":memory:");
		sqlite.exec(
			shippedTableDdl("0000_happy_roland_deschain", "outbox_message"),
		);
		sqlite.exec(shippedTableDdl("0013_low_harpoon", "outbox_attachment"));
		applyMigration(sqlite, "0015_true_meggan");
	});

	after(() => {
		sqlite.close();
	});

	test("makes a stranded sent message visible again", async () => {
		const stranded = Date.now() - STRANDED_AFTER_MILLIS - 1000;
		insert("stranded", "sent", stranded);

		const report = await sweepStrandedSentOutbox(clientOver(sqlite), "repair");

		assert.equal(report.stranded, 1);
		assert.equal(report.neverFiled, 1);
		assert.equal(report.settled, 1);
		const row = read("stranded");
		assert.equal(row?.status, "unfiled");
		assert.match(String(row?.last_error), /not filed/);
	});

	test("a second run writes nothing", async () => {
		const report = await sweepStrandedSentOutbox(clientOver(sqlite), "repair");

		assert.equal(report.stranded, 0);
		assert.equal(report.settled, 0);
		assert.equal(report.dropped, 0);
	});

	test("leaves a filing that is still in flight alone", async () => {
		insert("in-flight", "sent", Date.now());

		const report = await sweepStrandedSentOutbox(clientOver(sqlite), "repair");

		assert.equal(report.stranded, 0);
		assert.equal(read("in-flight")?.status, "sent");
	});

	test("touches no other status", async () => {
		const old = Date.now() - STRANDED_AFTER_MILLIS - 1000;
		insert("a-draft", "draft", old);
		insert("a-failure", "failed", old);

		await sweepStrandedSentOutbox(clientOver(sqlite), "repair");

		assert.equal(read("a-draft")?.status, "draft");
		assert.equal(read("a-failure")?.status, "failed");
	});

	test("check mode reports what it would do and writes nothing", async () => {
		insert("also-stranded", "sent", Date.now() - STRANDED_AFTER_MILLIS - 1000);

		const report = await sweepStrandedSentOutbox(clientOver(sqlite), "check");

		assert.equal(report.stranded, 1);
		assert.equal(report.settled, 0);
		assert.equal(read("also-stranded")?.status, "sent");
	});

	test("drops the leftover row of a message that was filed (#858)", async () => {
		const old = Date.now() - STRANDED_AFTER_MILLIS - 1000;
		insert("filed", "sent", old, 55);
		attach("filed");
		insert("never-filed", "sent", old);
		attach("never-filed");

		const report = await sweepStrandedSentOutbox(clientOver(sqlite), "repair");

		// The copy is in the user's Sent folder. Marking it unfiled would say the
		// message was never filed and show it in the Outbox alongside the copy.
		assert.equal(report.filed, 1);
		assert.equal(report.dropped, 1);
		assert.equal(read("filed"), undefined);

		// Its attachment rows go with it, so the objects stop being vouched for
		// and the scheduler's attachment sweep can collect them.
		assert.equal(attachmentCount("filed"), 0);

		assert.equal(read("never-filed")?.status, "unfiled");
		assert.equal(attachmentCount("never-filed"), 1);
	});

	test("check mode reports a filed leftover without dropping it", async () => {
		const old = Date.now() - STRANDED_AFTER_MILLIS - 1000;
		insert("filed-too", "sent", old, 55);

		const report = await sweepStrandedSentOutbox(clientOver(sqlite), "check");

		assert.equal(report.filed, 1);
		assert.equal(report.dropped, 0);
		assert.equal(read("filed-too")?.status, "sent");
	});

	test("counts a copy the server named no uid for as filed", async () => {
		// A server without UIDPLUS files the copy and reports nothing. Settling
		// that row unfiled would be as wrong as settling one with a real uid.
		insert("no-uid", "sent", Date.now() - STRANDED_AFTER_MILLIS - 1000, -1);

		const report = await sweepStrandedSentOutbox(clientOver(sqlite), "repair");

		assert.equal(report.filed, 2);
		assert.equal(report.dropped, 2);
		assert.equal(read("no-uid"), undefined);
		assert.equal(read("filed-too"), undefined);
	});
});
