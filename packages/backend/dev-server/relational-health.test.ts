import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { checkRelationalStore } from "./relational-health.js";

describe("checkRelationalStore", () => {
	const ORIGINAL_DATA_BACKEND = process.env.DATA_BACKEND;
	const ORIGINAL_SQLITE_DB_PATH = process.env.SQLITE_DB_PATH;
	let dir: string | undefined;

	afterEach(() => {
		if (ORIGINAL_DATA_BACKEND === undefined) delete process.env.DATA_BACKEND;
		else process.env.DATA_BACKEND = ORIGINAL_DATA_BACKEND;
		if (ORIGINAL_SQLITE_DB_PATH === undefined) {
			delete process.env.SQLITE_DB_PATH;
		} else {
			process.env.SQLITE_DB_PATH = ORIGINAL_SQLITE_DB_PATH;
		}
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
			dir = undefined;
		}
	});

	it("is true without touching disk on the AWS/DynamoDB path", async () => {
		delete process.env.DATA_BACKEND;
		delete process.env.SQLITE_DB_PATH;
		assert.equal(await checkRelationalStore(), true);

		process.env.DATA_BACKEND = "dynamodb";
		assert.equal(await checkRelationalStore(), true);
	});

	it("is true when the SQLite file is reachable", async () => {
		dir = mkdtempSync(join(tmpdir(), "remit-health-"));
		const dbPath = join(dir, "remit.db");
		new Database(dbPath).close();

		process.env.DATA_BACKEND = "sqlite";
		process.env.SQLITE_DB_PATH = dbPath;

		assert.equal(await checkRelationalStore(), true);
	});

	it("is false when SQLITE_DB_PATH points at a directory that does not exist", async () => {
		process.env.DATA_BACKEND = "sqlite";
		process.env.SQLITE_DB_PATH = "/nonexistent/remit.db";

		assert.equal(await checkRelationalStore(), false);
	});

	it("is false when the SQLite file exists but is unreadable", async () => {
		dir = mkdtempSync(join(tmpdir(), "remit-health-"));
		const dbPath = join(dir, "remit.db");
		new Database(dbPath).close();
		chmodSync(dbPath, 0o000);

		process.env.DATA_BACKEND = "sqlite";
		process.env.SQLITE_DB_PATH = dbPath;

		assert.equal(await checkRelationalStore(), false);
	});

	it("is false once a reachable file becomes unwritable while another connection in this process still holds it open", async () => {
		dir = mkdtempSync(join(tmpdir(), "remit-health-"));
		const dbPath = join(dir, "remit.db");
		// A held-open connection, standing in for better-auth's own persistent
		// handle to this same file (RFC 036 D3, one file). Without `access()` in
		// pingSqlite, this reproduces the bug this check exists to catch: SQLite
		// shares one already-validated handle per inode across same-process
		// connections, so a fresh connection here would have kept succeeding.
		const held = new Database(dbPath);

		process.env.DATA_BACKEND = "sqlite";
		process.env.SQLITE_DB_PATH = dbPath;
		assert.equal(await checkRelationalStore(), true);

		chmodSync(dbPath, 0o000);
		assert.equal(await checkRelationalStore(), false);

		held.close();
	});

	it("is false when Postgres connection fails", async () => {
		process.env.DATA_BACKEND = "postgres";
		process.env.PG_CONNECTION_URL =
			"postgresql://remit:remit@127.0.0.1:1/nonexistent";

		assert.equal(await checkRelationalStore(), false);
	});
});
