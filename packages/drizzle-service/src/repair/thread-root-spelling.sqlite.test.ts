import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { deriveThreadId } from "@remit/data-ports/id";
import type Database from "better-sqlite3";
import { DrizzleMessageRepository } from "../repos/message.js";
import { deriveThreadMessageId } from "../repos/thread-message.js";
import { createShippedSqliteDb } from "../test-sqlite.js";
import { moveMisfiledThreadRows } from "./thread-root-spelling.js";

const CONFIG = "cfg-1";
const PARENT = "<parent@remit.test>";
const DOUBLED = "<<parent@remit.test>>";

describe("thread rows filed under a doubled-bracket root", () => {
	let handle: ReturnType<typeof createShippedSqliteDb>;
	let sqlite: Database.Database;
	const created = new Set<string>();

	const insert = async (
		messageId: string,
		threadId: string,
		messageIdHeader: string,
		inReplyTo: string | null,
	): Promise<void> => {
		if (!created.has(messageId)) {
			created.add(messageId);
			await new DrizzleMessageRepository(
				handle.db as unknown as ConstructorParameters<
					typeof DrizzleMessageRepository
				>[0],
			).create({
				messageId,
				mailboxId: "mbx",
				uid: 1,
				sequenceNumber: 1,
				rfc822Size: 1,
				internalDate: 0,
				envelopeId: randomUUID(),
				rootBodyPartId: randomUUID(),
			});
		}
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

	const threadsOf = (messageId: string): string[] =>
		(
			sqlite
				.prepare("SELECT thread_id FROM thread_message WHERE message_id = ?")
				.all(messageId) as { thread_id: string }[]
		).map((row) => row.thread_id);

	const rootThread = deriveThreadId(CONFIG, "<root@remit.test>");
	const parentThread = deriveThreadId(CONFIG, PARENT);
	const splitThread = deriveThreadId(CONFIG, DOUBLED);

	before(() => {
		handle = createShippedSqliteDb();
		sqlite = handle.sqlite;
	});

	beforeEach(() => {
		created.clear();
		for (const table of ["thread_message", "message"]) {
			sqlite.exec(`DELETE FROM ${table}`);
		}
	});

	after(() => {
		handle.close();
	});

	test("moves a doubled reply and the mail that copied it into the parent's thread", async () => {
		await insert("m-parent", parentThread, PARENT, null);
		await insert("m-reply", splitThread, "<reply@remit.test>", DOUBLED);
		await insert(
			"m-answer",
			splitThread,
			"<answer@remit.test>",
			"<reply@remit.test>",
		);

		const report = await moveMisfiledThreadRows(handle.db, "repair");

		assert.equal(report.moved, 2);
		assert.deepEqual(threadsOf("m-reply"), [parentThread]);
		assert.deepEqual(threadsOf("m-answer"), [parentThread]);
	});

	test("follows a parent that is itself a reply into the thread it is stored in", async () => {
		await insert("m-parent", rootThread, PARENT, "<root@remit.test>");
		await insert("m-reply", splitThread, "<reply@remit.test>", DOUBLED);

		await moveMisfiledThreadRows(handle.db, "repair");

		assert.deepEqual(threadsOf("m-reply"), [rootThread]);
	});

	test("drops the stale row where sync already filed the message again", async () => {
		await insert("m-reply", splitThread, "<reply@remit.test>", DOUBLED);
		await insert("m-reply", parentThread, "<reply@remit.test>", DOUBLED);

		const report = await moveMisfiledThreadRows(handle.db, "repair");

		assert.equal(report.dropped, 1);
		assert.deepEqual(threadsOf("m-reply"), [parentThread]);
	});

	test("a second run finds nothing left to move", async () => {
		await insert("m-reply", splitThread, "<reply@remit.test>", DOUBLED);

		await moveMisfiledThreadRows(handle.db, "repair");
		const second = await moveMisfiledThreadRows(handle.db, "repair");

		assert.equal(second.misfiled, 0);
	});

	test("refuses to report success while rows stay misfiled", async () => {
		await insert("m-parent", splitThread, PARENT, null);
		await insert("m-reply", splitThread, "<reply@remit.test>", DOUBLED);

		await assert.rejects(
			moveMisfiledThreadRows(handle.db, "repair"),
			/still filed under a doubled-bracket root/,
		);
	});

	test("check mode reports the split and writes nothing", async () => {
		await insert("m-reply", splitThread, "<reply@remit.test>", DOUBLED);

		const report = await moveMisfiledThreadRows(handle.db, "check");

		assert.equal(report.misfiled, 1);
		assert.deepEqual(threadsOf("m-reply"), [splitThread]);
	});
});
