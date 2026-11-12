import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { openSqlite } from "./sqlite.js";

const counters = sqliteTable("counters", { value: integer("value") });
const schema = { counters };

describe("openSqlite", () => {
	const directory = mkdtempSync(join(tmpdir(), "open-sqlite-"));
	after(() => rmSync(directory, { recursive: true, force: true }));

	const writable = (filename: string) =>
		openSqlite({
			filename,
			readonly: false,
			mustExist: false,
			synchronous: "NORMAL",
			schema,
		});

	test("a writable file reports WAL", () => {
		const db = writable(join(directory, "wal.db"));
		assert.equal(db.$client.pragma("journal_mode", { simple: true }), "wal");
		db.$client.close();
	});

	test("a must-exist open of a missing file fails", () => {
		assert.throws(() =>
			openSqlite({
				filename: join(directory, "missing.db"),
				readonly: false,
				mustExist: true,
				synchronous: "NORMAL",
				schema,
			}),
		);
	});

	test("a readonly handle refuses a write", () => {
		const filename = join(directory, "readonly.db");
		const db = writable(filename);
		db.$client.exec("CREATE TABLE counters (value INTEGER)");
		db.$client.close();

		const reader = openSqlite({
			filename,
			readonly: true,
			mustExist: true,
			synchronous: "NORMAL",
			schema,
		});
		assert.throws(
			() => reader.insert(counters).values({ value: 1 }).run(),
			/readonly/,
		);
		reader.$client.close();
	});
});
