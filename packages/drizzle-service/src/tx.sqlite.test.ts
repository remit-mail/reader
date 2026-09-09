import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Db } from "./db.js";
import { runInTransaction } from "./tx.js";

/**
 * A write set that reads before it writes, against the file four processes
 * share (RFC 036 D3).
 *
 * SQLite gives a deferred transaction its write lock at its first write, and by
 * then a unit that read first is holding a snapshot. Another process committing
 * in that gap makes the upgrade impossible, and SQLite refuses it at once —
 * `busy_timeout` waits for a lock, not for a snapshot that is already stale. The
 * unit then dies with "database is locked" however long that timeout is, which
 * is what answered a calendar write 500 while the imap-worker was syncing.
 */

const PRAGMAS = [
	"journal_mode = WAL",
	"busy_timeout = 5000",
	"synchronous = NORMAL",
	"foreign_keys = ON",
];

let directory: string;
let sqlite: Database.Database;
let other: Database.Database;
let db: Db<Record<string, never>>;

before(() => {
	directory = mkdtempSync(join(tmpdir(), "remit-tx-"));
	const path = join(directory, "remit.db");

	sqlite = new Database(path);
	for (const pragma of PRAGMAS) sqlite.pragma(pragma);
	sqlite.exec("CREATE TABLE row (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
	sqlite.exec("INSERT INTO row (id, v) VALUES (1, 'read'), (2, 'other')");

	// The other writer, as a second connection. It refuses instead of waiting,
	// so the run finishes in its own time whichever of the two holds the lock.
	other = new Database(path);
	other.pragma("busy_timeout = 0");

	db = drizzle(sqlite) as unknown as Db<Record<string, never>>;
});

after(() => {
	other.close();
	sqlite.close();
	rmSync(directory, { recursive: true, force: true });
});

describe("a top-level sqlite unit that reads before it writes", () => {
	test("commits through another connection's write landing between the two", async () => {
		const outcome = await runInTransaction(db, async (tx) => {
			await tx.get(sql`SELECT v FROM row WHERE id = 1`);

			// The other process, arriving in the gap an async write set leaves
			// open. Whether its own write lands is not the claim here — only that
			// this unit can still finish the one it came to make.
			try {
				other.prepare("UPDATE row SET v = 'moved' WHERE id = 2").run();
			} catch {
				// Refused because this unit holds the write lock, which is the
				// outcome that keeps the unit below alive.
			}

			await tx.run(sql`UPDATE row SET v = 'written' WHERE id = 1`);
			return "committed";
		});

		assert.equal(outcome, "committed");
		assert.deepEqual(sqlite.prepare("SELECT v FROM row WHERE id = 1").get(), {
			v: "written",
		});
	});
});
