// A `sqlite3 <database> <sql>` stand-in backed by node:sqlite, so the snapshot
// primitive can be exercised against a real WAL database on a box that has no
// sqlite3 CLI. It is the same engine, reached a different way — VACUUM INTO
// here is SQLite's own, not a simulation of it.
import { DatabaseSync } from "node:sqlite";

const [database, sql] = process.argv.slice(2);
const db = new DatabaseSync(database);
try {
	db.exec(sql);
} finally {
	db.close();
}
