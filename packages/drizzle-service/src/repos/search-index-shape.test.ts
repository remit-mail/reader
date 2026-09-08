/**
 * The guard that keeps an instance installed by an earlier build from running a
 * predicate its index cannot answer.
 *
 * `CREATE VIRTUAL TABLE IF NOT EXISTS` is a no-op against an existing table, so
 * adding an indexed column changes nothing on a database that already has the
 * old one — and a MATCH naming that column raises rather than missing. The
 * migrator compares the shipped shape with the installed one and rebuilds.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	searchIndexColumns,
	searchIndexShapeIsCurrent,
} from "./search-index-shape.js";

const shipped = readFileSync(
	new URL("../../../../npm-scripts/sqlite-search-index.sql", import.meta.url),
	"utf8",
);

const installed = (columns: string[]): string =>
	`CREATE VIRTUAL TABLE thread_message_fts USING fts5(${columns.join(", ")}, content='thread_message', content_rowid='rowid', tokenize='trigram remove_diacritics 1')`;

describe("searchIndexColumns", () => {
	test("reads the indexed columns and leaves the options out", () => {
		assert.deepEqual(searchIndexColumns(installed(["subject", "sender"])), [
			"subject",
			"sender",
		]);
	});

	test("reads the shipped index, triggers and all", () => {
		assert.deepEqual(searchIndexColumns(shipped), [
			"subject",
			"sender",
			"body",
		]);
	});

	test("a table that is not an fts5 index has no columns", () => {
		assert.deepEqual(searchIndexColumns("CREATE TABLE t (a, b)"), []);
	});
});

describe("searchIndexShapeIsCurrent", () => {
	test("the shipped index matches itself", () => {
		assert.equal(searchIndexShapeIsCurrent(shipped, shipped), true);
	});

	// The upgrade this exists for: an instance carrying the two-column index the
	// previous build installed must be rebuilt, or every search raises.
	test("an index missing an indexed column is stale", () => {
		assert.equal(
			searchIndexShapeIsCurrent(installed(["subject", "sender"]), shipped),
			false,
		);
	});

	test("an index carrying every shipped column is current", () => {
		assert.equal(
			searchIndexShapeIsCurrent(
				installed(["subject", "sender", "body"]),
				shipped,
			),
			true,
		);
	});

	// An extra column indexes text nothing reads. It costs space and matches
	// nothing wrong, so it is not a reason to drop and re-tokenize the table.
	test("an index carrying more than the shipped columns is current", () => {
		assert.equal(
			searchIndexShapeIsCurrent(
				installed(["subject", "sender", "body", "labels"]),
				shipped,
			),
			true,
		);
	});
});
