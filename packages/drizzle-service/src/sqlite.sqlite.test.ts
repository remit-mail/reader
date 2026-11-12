import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { openSqlite } from "./sqlite.js";
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
