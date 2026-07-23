// deploy/vps/backup/snapshot-db.sh — the one SQLite snapshot primitive, shared
// by the nightly backup sidecar and `remit update` (RFC 037 R8).
//
// The rollback the self-update promises is only as good as this: a copy taken
// after the stop loses every transaction still in the write-ahead log and the
// restore looks clean, which is the failure these tests exist to catch.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const LIB = join(ROOT, "deploy", "vps", "backup", "snapshot-db.sh");
const SHIM = join(HERE, "remit-test", "sqlite3-shim.mjs");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

function sandbox() {
	const dir = mkdtempSync(join(TMP_ROOT, "snapshot-db-"));
	sandboxes.push(dir);
	const bin = join(dir, "bin");
	mkdirSync(bin);
	// A `sqlite3` that is really node:sqlite, so this runs on a box without the
	// CLI installed.
	execFileSync("sh", [
		"-c",
		`printf '#!/bin/sh\\nexec node "%s" "$@"\\n' "${SHIM}" > "${join(bin, "sqlite3")}" && chmod +x "${join(bin, "sqlite3")}"`,
	]);
	return { dir, bin };
}

function snapshot({ bin }, source, destination) {
	return execFileSync(
		"sh",
		[
			"-c",
			`. "$1"; snapshot_db "$2" "$3"`,
			"snapshot",
			LIB,
			source,
			destination,
		],
		{
			encoding: "utf8",
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
		},
	);
}

describe("snapshot_db", () => {
	it("carries writes that are still only in the write-ahead log", () => {
		const box = sandbox();
		const source = join(box.dir, "remit.db");
		const db = new DatabaseSync(source);
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA wal_autocheckpoint = 0");
		db.exec("CREATE TABLE message (id INTEGER PRIMARY KEY, subject TEXT)");
		db.exec("INSERT INTO message VALUES (1, 'before')");
		db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		// From here on the writer stays open, so these rows live in the -wal and
		// not in the main file: exactly the state a live instance is in when an
		// update snapshots it.
		db.exec("INSERT INTO message VALUES (2, 'in flight')");

		const destination = join(box.dir, "snapshot.db");
		snapshot(box, source, destination);

		const restored = new DatabaseSync(destination);
		const rows = restored
			.prepare("SELECT subject FROM message ORDER BY id")
			.all();
		restored.close();
		assert.deepEqual(
			rows.map((r) => r.subject),
			["before", "in flight"],
		);

		// The same file copied rather than snapshotted comes back without the
		// in-flight write, which is why VACUUM INTO is not an implementation
		// detail here.
		const copied = join(box.dir, "copied.db");
		copyFileSync(source, copied);
		const naive = new DatabaseSync(copied);
		const naiveRows = naive.prepare("SELECT subject FROM message").all();
		naive.close();
		db.close();
		assert.deepEqual(
			naiveRows.map((r) => r.subject),
			["before"],
		);
	});

	it("treats a source that does not exist yet as a complete snapshot", () => {
		// The vector store is created by the search-index worker on its first
		// embedding write, so a young instance legitimately has none.
		const box = sandbox();
		const destination = join(box.dir, "vec-snapshot.db");
		const output = snapshot(box, join(box.dir, "vec.db"), destination);
		assert.match(output, /does not exist yet/);
		assert.equal(existsSync(destination), false);
	});

	it("does not create a database at a missing source path", () => {
		const box = sandbox();
		const source = join(box.dir, "vec.db");
		snapshot(box, source, join(box.dir, "out.db"));
		assert.equal(existsSync(source), false);
	});
});
