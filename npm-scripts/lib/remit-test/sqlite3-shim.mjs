// A `sqlite3 <database> <sql>` stand-in backed by node:sqlite, so the snapshot
// primitive and the schema read can be exercised against a real WAL database on
// a box that has no sqlite3 CLI. It is the same engine, reached a different way
// — VACUUM INTO here is SQLite's own, not a simulation of it.
//
// A SELECT prints its rows the way the CLI's list mode does (values only, one
// row per line, columns joined by `|`), so a `SELECT count(*)` returns a number
// on stdout. Everything else — VACUUM INTO, ALTER, INSERT — runs through exec.
import { DatabaseSync } from "node:sqlite";

const [database, sql] = process.argv.slice(2);
const db = new DatabaseSync(database);
try {
	if (/^\s*select/i.test(sql)) {
		for (const row of db.prepare(sql).all()) {
			console.log(Object.values(row).join("|"));
		}
	} else {
		db.exec(sql);
	}
} finally {
	db.close();
}
