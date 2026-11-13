import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { BETTER_SQLITE3_LIMITS } from "./bound-parameters.js";
import { isUniqueViolation } from "./error.js";
import { openSqlite, openTestSqlite } from "./sqlite.js";
import { failedWith } from "./test-error.js";

const counters = sqliteTable("counters", { value: integer("value") });
const schema = { counters };

describe("openSqlite", () => {
	const directory = mkdtempSync(join(tmpdir(), "open-sqlite-"));
	after(() => rmSync(directory, { recursive: true, force: true }));

	const create = (filename: string) =>
		openSqlite({ filename, mode: "create", synchronous: "NORMAL", schema });

	test("a writable file reports WAL", () => {
		const handle = create(join(directory, "wal.db"));
		assert.deepEqual(handle.db.get(sql`PRAGMA journal_mode`), {
			journal_mode: "wal",
		});
		handle.close();
	});

	test("opening a missing file that must exist fails", () => {
		assert.throws(() =>
			openSqlite({
				filename: join(directory, "missing.db"),
				mode: "open",
				synchronous: "NORMAL",
				schema,
			}),
		);
	});

	test("a readonly handle refuses a write", () => {
		const filename = join(directory, "readonly.db");
		const writer = create(filename);
		writer.exec("CREATE TABLE counters (value INTEGER)");
		writer.close();

		const reader = openSqlite({
			filename,
			mode: "readonly",
			synchronous: "NORMAL",
			schema,
		});
		assert.throws(
			() => reader.db.insert(counters).values({ value: 1 }).run(),
			failedWith(/readonly/),
		);
		reader.close();
	});
});

describe("a node:sqlite handle", () => {
	const people = sqliteTable("people", {
		personId: text("person_id").primaryKey(),
		email: text("email").notNull().unique(),
	});

	const withPeople = () => {
		const handle = openTestSqlite({ people });
		handle.exec(
			"CREATE TABLE people (person_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE)",
		);
		handle.db.insert(people).values({ personId: "p1", email: "a@x" }).run();
		return handle;
	};

	test("a primary-key collision is a unique violation", () => {
		const handle = withPeople();
		assert.throws(
			() =>
				handle.db.insert(people).values({ personId: "p1", email: "b@x" }).run(),
			isUniqueViolation,
		);
		handle.close();
	});

	test("a unique-index collision is a unique violation", () => {
		const handle = withPeople();
		assert.throws(
			() =>
				handle.db.insert(people).values({ personId: "p2", email: "a@x" }).run(),
			isUniqueViolation,
		);
		handle.close();
	});

	test("a NOT NULL failure is not a unique violation", () => {
		const handle = withPeople();
		assert.throws(
			() =>
				handle.sqlite
					.prepare("INSERT INTO people (person_id, email) VALUES (?, ?)")
					.run("p3", null),
			(error: unknown) =>
				!isUniqueViolation(error) &&
				failedWith(/NOT NULL constraint failed/)(error),
		);
		handle.close();
	});

	test("run counts changes as a number and rows read back as plain objects", () => {
		const handle = withPeople();
		const { changes } = handle.sqlite
			.prepare("UPDATE people SET email = ? WHERE person_id = ?")
			.run("c@x", "p1");
		assert.equal(changes, 1);
		assert.deepEqual(handle.sqlite.prepare("SELECT * FROM people").all(), [
			{ person_id: "p1", email: "c@x" },
		]);
		assert.deepEqual(
			[...handle.sqlite.prepare("SELECT email FROM people").iterate()],
			[{ email: "c@x" }],
		);
		handle.close();
	});

	test("immediate rolls back every write when the work throws", () => {
		const handle = withPeople();
		assert.throws(
			() =>
				handle.immediate(() => {
					handle.db
						.insert(people)
						.values({ personId: "p2", email: "b@x" })
						.run();
					throw new Error("abort");
				}),
			/abort/,
		);
		assert.deepEqual(
			handle.sqlite.prepare("SELECT person_id FROM people").all(),
			[{ person_id: "p1" }],
		);
		handle.close();
	});

	test("a statement binds the full bound-parameter limit", () => {
		const handle = openTestSqlite({});
		const limit = BETTER_SQLITE3_LIMITS.maxBoundParameters;
		const params = Array.from({ length: limit }, (_, index) => index);
		const placeholders = params.map(() => "?").join(",");
		assert.deepEqual(
			handle.sqlite
				.prepare(`SELECT 0 IN (${placeholders}) AS n`)
				.get(...params),
			{ n: 1 },
		);
		assert.throws(
			() =>
				handle.sqlite
					.prepare(`SELECT 0 IN (${placeholders}, ?) AS n`)
					.get(...params, limit),
			/too many SQL variables/,
		);
		handle.close();
	});
});
