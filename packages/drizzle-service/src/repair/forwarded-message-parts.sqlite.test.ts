import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { BodyPartUpsertInput } from "@remit/data-ports";
import type Database from "better-sqlite3";
import { DrizzleEnvelopeRepository } from "../repos/envelope.js";
import { DrizzleMessageRepository } from "../repos/message.js";
import { createShippedSqliteDb } from "../test-sqlite.js";
import {
	type ForwardedPartsRepairClient,
	sweepForwardedMessageParts,
} from "./forwarded-message-parts.js";

const leaf = (
	partPath: string,
	parentPartPath: string,
	mediaType: BodyPartUpsertInput["mediaType"],
	mediaSubtype: string,
): BodyPartUpsertInput => ({
	partPath,
	parentPartPath,
	mediaType,
	mediaSubtype,
	transferEncoding: "7BIT",
	sizeOctets: 40,
	isMultipart: false,
	parameters: [],
});

const mixed = (
	partPath: string,
	parentPartPath: string | null,
): BodyPartUpsertInput => ({
	...leaf(partPath, parentPartPath ?? "", "MULTIPART", "mixed"),
	parentPartPath,
	isMultipart: true,
	multipartSubtype: "mixed",
	parameters: [{ parameterName: "boundary", parameterValue: partPath }],
});

/** Adversarial fixture 04 as the old walker emitted it: the forwarded root reuses part "2". */
const OVERWRITTEN_FORWARD: BodyPartUpsertInput[] = [
	mixed("0", null),
	leaf("1", "0", "TEXT", "plain"),
	{
		...leaf("2", "0", "MESSAGE", "rfc822"),
		disposition: "attachment",
		dispositionFilename: "forwarded.eml",
	},
	mixed("2", "2"),
	leaf("2.1", "2", "TEXT", "plain"),
	{
		...leaf("2.2", "2", "APPLICATION", "pdf"),
		disposition: "attachment",
		dispositionFilename: "original.pdf",
	},
];

const PLAIN: BodyPartUpsertInput[] = [
	mixed("0", null),
	leaf("1", "0", "TEXT", "plain"),
	{
		...leaf("2", "0", "APPLICATION", "pdf"),
		disposition: "attachment",
		dispositionFilename: "invoice.pdf",
	},
];

const clientOver = (sqlite: Database.Database): ForwardedPartsRepairClient => ({
	all: async (sql, params) => sqlite.prepare(sql).all(...params),
	run: async (sql, params) => sqlite.prepare(sql).run(...params).changes,
});

describe("messages whose forwarded message lost its part row", () => {
	let handle: ReturnType<typeof createShippedSqliteDb>;
	let sqlite: Database.Database;

	const mailbox = (mailboxId: string, lastSyncUid: number): void => {
		sqlite
			.prepare(
				`INSERT INTO mailbox (
					mailbox_id, account_id, namespace_prefix, hierarchy_delimiter,
					full_path, uid_validity, uid_next, highest_modseq, message_count,
					unseen_count, deleted_count, total_size, last_sync_uid,
					high_water_mark_uid, last_message_sync_at, created_at, updated_at
				) VALUES (?, 'acc', '', '/', ?, 1, 100, '1234', 0, 0, 0, 0, ?, 99, 0, 0, 0)`,
			)
			.run(mailboxId, mailboxId, lastSyncUid);
	};

	const message = async (
		messageId: string,
		mailboxId: string,
		uid: number,
		parts: BodyPartUpsertInput[],
	): Promise<void> => {
		const db = handle.db as unknown as ConstructorParameters<
			typeof DrizzleMessageRepository
		>[0];
		await new DrizzleMessageRepository(db).create({
			messageId,
			mailboxId,
			uid,
			sequenceNumber: uid,
			rfc822Size: 1,
			internalDate: 0,
			envelopeId: randomUUID(),
			rootBodyPartId: randomUUID(),
		});
		await new DrizzleEnvelopeRepository(
			handle.db as unknown as ConstructorParameters<
				typeof DrizzleEnvelopeRepository
			>[0],
		).upsertBodyParts(messageId, parts);
	};

	const count = (table: string, messageId: string): number =>
		(
			sqlite
				.prepare(`SELECT count(*) AS n FROM ${table} WHERE message_id = ?`)
				.get(messageId) as { n: number }
		).n;

	const cursor = (
		mailboxId: string,
	): { last_sync_uid: number; highest_modseq: string } =>
		sqlite
			.prepare(
				"SELECT last_sync_uid, highest_modseq FROM mailbox WHERE mailbox_id = ?",
			)
			.get(mailboxId) as { last_sync_uid: number; highest_modseq: string };

	before(async () => {
		handle = createShippedSqliteDb();
		sqlite = handle.sqlite;
		mailbox("inbox", 1);
		mailbox("archive", 1);
		mailbox("backfilling", 80);
		await message("forwarded", "inbox", 42, OVERWRITTEN_FORWARD);
		await message("forwarded-older", "inbox", 7, OVERWRITTEN_FORWARD);
		await message("healthy", "archive", 5, PLAIN);
		await message(
			"forwarded-unreached",
			"backfilling",
			12,
			OVERWRITTEN_FORWARD,
		);
	});

	after(() => {
		handle.close();
	});

	test("check mode reports what it would do and writes nothing", async () => {
		const report = await sweepForwardedMessageParts(
			clientOver(sqlite),
			"check",
		);

		assert.equal(report.messages, 3);
		assert.equal(report.mailboxes, 2);
		assert.equal(report.partsDropped, 0);
		assert.equal(count("body_part", "forwarded"), 5);
		assert.deepEqual(cursor("inbox"), {
			last_sync_uid: 1,
			highest_modseq: "1234",
		});
	});

	test("drops the broken parts and sets their folder to fetch them again", async () => {
		const report = await sweepForwardedMessageParts(
			clientOver(sqlite),
			"repair",
		);

		assert.equal(report.messages, 3);
		assert.equal(report.partsDropped, 15);
		assert.equal(report.mailboxesRewound, 2);
		for (const messageId of ["forwarded", "forwarded-older"]) {
			assert.equal(count("body_part", messageId), 0);
			assert.equal(count("body_part_parameter", messageId), 0);
		}
		assert.deepEqual(cursor("inbox"), {
			last_sync_uid: 43,
			highest_modseq: "",
		});
	});

	test("never moves a backfill cursor that has not reached the message yet", () => {
		assert.equal(cursor("backfilling").last_sync_uid, 80);
	});

	test("leaves every other message and folder alone", () => {
		assert.equal(count("body_part", "healthy"), 3);
		assert.equal(count("body_part_parameter", "healthy"), 1);
		assert.deepEqual(cursor("archive"), {
			last_sync_uid: 1,
			highest_modseq: "1234",
		});
	});

	test("a second run writes nothing", async () => {
		const report = await sweepForwardedMessageParts(
			clientOver(sqlite),
			"repair",
		);

		assert.equal(report.messages, 0);
		assert.equal(report.partsDropped, 0);
	});

	test("a failed write rolls the whole repair back and is raised", async () => {
		const broken = createShippedSqliteDb();
		const previous = handle;
		handle = broken;
		sqlite = broken.sqlite;
		mailbox("inbox", 1);
		await message("forwarded", "inbox", 42, OVERWRITTEN_FORWARD);
		sqlite.exec("DROP TABLE mailbox");

		await assert.rejects(
			sweepForwardedMessageParts(clientOver(sqlite), "repair"),
		);
		assert.equal(count("body_part", "forwarded"), 5);

		broken.close();
		handle = previous;
		sqlite = previous.sqlite;
	});
});
