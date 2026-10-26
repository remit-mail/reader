import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { chunkRows, rowsPerStatement } from "./bound-parameters.js";

const tenColumns = sqliteTable("ten_columns", {
	c0: text("c0"),
	c1: text("c1"),
	c2: text("c2"),
	c3: text("c3"),
	c4: text("c4"),
	c5: text("c5"),
	c6: text("c6"),
	c7: text("c7"),
	c8: text("c8"),
	c9: integer("c9"),
});

const rows = (count: number): number[] =>
	Array.from({ length: count }, (_, index) => index);

describe("chunkRows", () => {
	test("no rows make no statements", () => {
		assert.deepEqual(chunkRows(tenColumns, [], 100), []);
	});

	test("rows that fill the limit exactly make one statement", () => {
		const chunks = chunkRows(tenColumns, rows(10), 100);
		assert.deepEqual(
			chunks.map((slice) => slice.length),
			[10],
		);
	});

	test("one row over the limit makes a second statement", () => {
		const chunks = chunkRows(tenColumns, rows(11), 100);
		assert.deepEqual(
			chunks.map((slice) => slice.length),
			[10, 1],
		);
		assert.deepEqual(chunks.flat(), rows(11));
	});

	test("reserved parameters shrink every statement", () => {
		const chunks = chunkRows(tenColumns, rows(10), 100, 1);
		assert.deepEqual(
			chunks.map((slice) => slice.length),
			[9, 1],
		);
	});
});

describe("rowsPerStatement", () => {
	test("a row wider than the limit is refused", () => {
		assert.throws(() => rowsPerStatement(100, 101), RangeError);
	});
});
