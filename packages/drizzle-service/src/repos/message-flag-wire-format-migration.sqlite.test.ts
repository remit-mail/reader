import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import { MessageSystemFlag } from "@remit/domain-enums";
import type Database from "better-sqlite3";
import {
	type MessageDataSchema,
	messageDataSchema,
} from "../schema/message-data.js";
import { createSqliteTestDb, type SqliteTestDb } from "../test-db-sqlite.js";
import { DrizzleMessageFlagRepository } from "./message-flag.js";

/**
 * The one-time `message_flag.flag_name` rename shipped for issue #64, run
 * against a real database rather than a hand-copied twin: the SQL is read
 * from the committed migration so this test fails if that file drifts.
 *
 * Before the generated-enum fix, `MessageSystemFlag.Seen` held `Seen` and
 * every row landed under the unprefixed spelling. `hasFlag` is an exact
 * string match, so once the corrected code queries `\Seen` those rows go
 * invisible — which is a re-star on unstar, and a silent no-op on
 * mark-as-unread.
 */
const MIGRATION_SQL = readFileSync(
	new URL(
		"../../../../deploy/vps/migrations-sqlite/entities/0002_system_flag_wire_format.sql",
		import.meta.url,
	),
	"utf8",
);

const applyMigration = (sqlite: Database.Database): void => {
	for (const statement of MIGRATION_SQL.split("--> statement-breakpoint")) {
		sqlite.exec(statement);
	}
};

const MESSAGE_ID = "00000000-0000-0000-6464-000000000001";
const OTHER_MESSAGE_ID = "00000000-0000-0000-6464-000000000002";

describe("message_flag wire-format migration (issue #64, sqlite)", () => {
	let db: SqliteTestDb<MessageDataSchema>;
	let sqlite: Database.Database;
	let close: () => Promise<void>;
	let repo: DrizzleMessageFlagRepository;

	const insertLegacyRow = (messageId: string, flagName: string): void => {
		sqlite
			.prepare(
				`INSERT INTO message_flag
				   (message_flag_id, message_id, flag_name, set_at, created_at, updated_at)
				 VALUES (?, ?, ?, 1000, 1000, 1000)`,
			)
			.run(`${messageId}:${flagName}`, messageId, flagName);
	};

	const flagNames = (messageId: string): string[] =>
		(
			sqlite
				.prepare(
					"SELECT flag_name FROM message_flag WHERE message_id = ? ORDER BY flag_name",
				)
				.all(messageId) as Array<{ flag_name: string }>
		).map((r) => r.flag_name);

	beforeEach(async () => {
		({ db, sqlite, close } = await createSqliteTestDb(messageDataSchema));
		repo = new DrizzleMessageFlagRepository(
			db as unknown as ConstructorParameters<
				typeof DrizzleMessageFlagRepository
			>[0],
		);
	});

	afterEach(async () => {
		await close();
	});

	test("a row written under the old spelling is found by the corrected enum", async () => {
		insertLegacyRow(MESSAGE_ID, "Flagged");
		assert.equal(
			await repo.hasFlag(MESSAGE_ID, MessageSystemFlag.Flagged),
			false,
		);

		applyMigration(sqlite);

		assert.equal(
			await repo.hasFlag(MESSAGE_ID, MessageSystemFlag.Flagged),
			true,
		);
		assert.deepEqual(flagNames(MESSAGE_ID), ["\\Flagged"]);
	});

	test("unstarring a migrated message removes the star instead of re-adding it", async () => {
		insertLegacyRow(MESSAGE_ID, "Flagged");
		applyMigration(sqlite);

		// The toggleFlagged decision: hasFlag true => operation "remove".
		const hadFlag = await repo.hasFlag(MESSAGE_ID, MessageSystemFlag.Flagged);
		assert.equal(hadFlag, true, "pre-migration row must read as starred");

		await repo.removeFlag(MESSAGE_ID, MessageSystemFlag.Flagged);
		assert.equal(
			await repo.hasFlag(MESSAGE_ID, MessageSystemFlag.Flagged),
			false,
		);
		assert.deepEqual(flagNames(MESSAGE_ID), []);
	});

	test("mark-as-unread on a migrated message clears the read state", async () => {
		insertLegacyRow(MESSAGE_ID, "Seen");
		applyMigration(sqlite);

		assert.equal(await repo.hasFlag(MESSAGE_ID, MessageSystemFlag.Seen), true);
		await repo.removeFlag(MESSAGE_ID, MessageSystemFlag.Seen);
		assert.equal(await repo.hasFlag(MESSAGE_ID, MessageSystemFlag.Seen), false);
	});

	test("renames every RFC 9051 system flag", () => {
		for (const name of ["Seen", "Answered", "Flagged", "Deleted", "Draft"]) {
			insertLegacyRow(MESSAGE_ID, name);
		}

		applyMigration(sqlite);

		assert.deepEqual(
			flagNames(MESSAGE_ID).sort(),
			Object.values(MessageSystemFlag).slice().sort(),
		);
	});

	test("leaves keyword and custom flags untouched", () => {
		insertLegacyRow(MESSAGE_ID, "$Forwarded");
		insertLegacyRow(MESSAGE_ID, "$Junk");
		insertLegacyRow(MESSAGE_ID, "project-invoices");

		applyMigration(sqlite);

		assert.deepEqual(flagNames(MESSAGE_ID), [
			"$Forwarded",
			"$Junk",
			"project-invoices",
		]);
	});

	test("is idempotent — a second and third run change nothing", () => {
		insertLegacyRow(MESSAGE_ID, "Seen");
		insertLegacyRow(OTHER_MESSAGE_ID, "Flagged");
		insertLegacyRow(OTHER_MESSAGE_ID, "$Forwarded");

		applyMigration(sqlite);
		const afterFirst = [
			...flagNames(MESSAGE_ID),
			...flagNames(OTHER_MESSAGE_ID),
		];

		applyMigration(sqlite);
		applyMigration(sqlite);

		assert.deepEqual(
			[...flagNames(MESSAGE_ID), ...flagNames(OTHER_MESSAGE_ID)],
			afterFirst,
		);
		assert.deepEqual(afterFirst, ["\\Seen", "$Forwarded", "\\Flagged"]);
	});

	test("collapses a message already carrying both spellings to one row", () => {
		insertLegacyRow(MESSAGE_ID, "Seen");
		insertLegacyRow(MESSAGE_ID, "\\Seen");

		applyMigration(sqlite);

		assert.deepEqual(flagNames(MESSAGE_ID), ["\\Seen"]);
	});

	test("does not touch other messages' rows", () => {
		insertLegacyRow(MESSAGE_ID, "Seen");
		insertLegacyRow(OTHER_MESSAGE_ID, "Seen");

		applyMigration(sqlite);

		assert.deepEqual(flagNames(MESSAGE_ID), ["\\Seen"]);
		assert.deepEqual(flagNames(OTHER_MESSAGE_ID), ["\\Seen"]);
	});
});
