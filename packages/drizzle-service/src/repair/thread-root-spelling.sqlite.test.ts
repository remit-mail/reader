import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { deriveThreadId } from "@remit/data-ports/id";
import type Database from "better-sqlite3";
import { deriveThreadMessageId } from "../repos/thread-message.js";
import { createShippedSqliteDb } from "../test-sqlite.js";
import {
	sweepThreadRootSpelling,
	type ThreadRootRepairClient,
} from "./thread-root-spelling.js";

const CONFIG = "cfg-1";
const PARENT = "<parent@remit.test>";
const DOUBLED = "<<parent@remit.test>>";

const clientOver = (sqlite: Database.Database): ThreadRootRepairClient => ({
	all: async (sql, params) => sqlite.prepare(sql).all(...params),
	run: async (sql, params) => sqlite.prepare(sql).run(...params).changes,
});

describe("threads keyed on a misspelt root Message-ID", () => {
	let sqlite: Database.Database;
	let close: () => void;

	const insert = (
		messageId: string,
		threadId: string,
		messageIdHeader: string,
		inReplyTo: string | null,
	): void => {
		sqlite
			.prepare(
				`INSERT INTO thread_message (
					thread_message_id, thread_id, message_id, account_config_id,
					mailbox_id, uid, message_id_header, in_reply_to, reference_order,
					internal_date, sent_date, is_read, has_attachment, has_stars,
					is_deleted, created_at, updated_at
				) VALUES (?, ?, ?, ?, 'mbx', 1, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
			)
			.run(
				deriveThreadMessageId(threadId, messageId),
				threadId,
				messageId,
				CONFIG,
				messageIdHeader,
				inReplyTo,
			);
	};

	const rowsOf = (
		messageId: string,
	): { thread_message_id: string; thread_id: string; in_reply_to: string }[] =>
		sqlite
			.prepare(
				"SELECT thread_message_id, thread_id, in_reply_to FROM thread_message WHERE message_id = ?",
			)
			.all(messageId) as {
			thread_message_id: string;
			thread_id: string;
			in_reply_to: string;
		}[];

	const parentThread = deriveThreadId(CONFIG, PARENT);
	const splitThread = deriveThreadId(CONFIG, DOUBLED);

	before(() => {
		({ sqlite, close } = createShippedSqliteDb());
	});

	beforeEach(() => {
		sqlite.exec("DELETE FROM thread_message");
		sqlite.exec("DELETE FROM outbox");
	});

	after(() => {
		close();
	});

	test("moves a doubled reply and the mail that copied it into the parent's thread", async () => {
		insert("m-parent", parentThread, PARENT, null);
		insert("m-reply", splitThread, "<reply@remit.test>", DOUBLED);
		// The correspondent's answer: its own In-Reply-To is well formed, but its
		// References copied the doubled root, so it was keyed with the reply.
		insert(
			"m-answer",
			splitThread,
			"<answer@remit.test>",
			"<reply@remit.test>",
		);

		const report = await sweepThreadRootSpelling(clientOver(sqlite), "repair");

		assert.equal(report.misfiled, 2);
		assert.equal(report.moved, 2);
		for (const messageId of ["m-reply", "m-answer"]) {
			const [row] = rowsOf(messageId);
			assert.equal(row?.thread_id, parentThread);
			assert.equal(
				row?.thread_message_id,
				deriveThreadMessageId(parentThread, messageId),
			);
		}
		assert.equal(rowsOf("m-reply")[0]?.in_reply_to, PARENT);
	});

	test("queues each moved message once for the forced re-index a move gets", async () => {
		insert("m-reply", splitThread, "<reply@remit.test>", DOUBLED);

		const report = await sweepThreadRootSpelling(clientOver(sqlite), "repair");
		await sweepThreadRootSpelling(clientOver(sqlite), "repair");

		assert.equal(report.reindexed, 1);
		assert.deepEqual(
			sqlite
				.prepare(
					"SELECT message_id, event FROM outbox WHERE processed_at IS NULL",
				)
				.all(),
			[{ message_id: "m-reply", event: "message.moved" }],
		);
	});

	test("drops the stale row where sync already filed the message again", async () => {
		insert("m-reply", splitThread, "<reply@remit.test>", DOUBLED);
		insert("m-reply", parentThread, "<reply@remit.test>", PARENT);

		const report = await sweepThreadRootSpelling(clientOver(sqlite), "repair");

		assert.equal(report.dropped, 1);
		assert.deepEqual(
			rowsOf("m-reply").map((row) => row.thread_id),
			[parentThread],
		);
	});

	test("a second run writes nothing", async () => {
		insert("m-reply", splitThread, "<reply@remit.test>", DOUBLED);
		await sweepThreadRootSpelling(clientOver(sqlite), "repair");

		const report = await sweepThreadRootSpelling(clientOver(sqlite), "repair");

		assert.equal(report.misfiled, 0);
		assert.equal(report.misspeltInReplyTo, 0);
		assert.equal(report.rewritten, 0);
	});

	test("leaves a well-spelt thread alone", async () => {
		insert("m-parent", parentThread, PARENT, null);
		insert("m-plain", parentThread, "<plain@remit.test>", PARENT);

		const report = await sweepThreadRootSpelling(clientOver(sqlite), "repair");

		assert.equal(report.misfiled, 0);
		assert.equal(rowsOf("m-plain")[0]?.thread_id, parentThread);
	});

	test("check mode reports the split and writes nothing", async () => {
		insert("m-reply", splitThread, "<reply@remit.test>", DOUBLED);

		const report = await sweepThreadRootSpelling(clientOver(sqlite), "check");

		assert.equal(report.misfiled, 1);
		assert.equal(report.moved, 0);
		assert.equal(rowsOf("m-reply")[0]?.thread_id, splitThread);
		assert.equal(rowsOf("m-reply")[0]?.in_reply_to, DOUBLED);
	});
});
