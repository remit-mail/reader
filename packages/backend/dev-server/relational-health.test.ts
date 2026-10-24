import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { SQLITE_DATABASE_ENV } from "@remit/drizzle-service";
import Database from "better-sqlite3";
import { checkRelationalStore } from "./relational-health.js";

const DATABASE_ENV = Object.values(SQLITE_DATABASE_ENV);

// Each database beside the one under test is a healthy file in the same
// directory, so a test speaks about `path` alone.
const pointAt = (path: string, directory: string): void => {
	for (const name of DATABASE_ENV) {
		const sibling = join(directory, `${name}.db`);
		new Database(sibling).close();
		process.env[name] = sibling;
	}
	process.env[SQLITE_DATABASE_ENV.mail] = path;
};

describe("checkRelationalStore", () => {
	const ORIGINAL_DATA_BACKEND = process.env.DATA_BACKEND;
	const ORIGINAL_PATHS = DATABASE_ENV.map((name) => process.env[name]);
	let dir: string | undefined;

	afterEach(() => {
		if (ORIGINAL_DATA_BACKEND === undefined) delete process.env.DATA_BACKEND;
		else process.env.DATA_BACKEND = ORIGINAL_DATA_BACKEND;
		DATABASE_ENV.forEach((name, index) => {
			const original = ORIGINAL_PATHS[index];
			if (original === undefined) delete process.env[name];
			else process.env[name] = original;
		});
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
			dir = undefined;
		}
	});

	it("is true without touching disk on the AWS/DynamoDB path", async () => {
		delete process.env.DATA_BACKEND;
		for (const name of DATABASE_ENV) delete process.env[name];
		assert.equal(await checkRelationalStore(), true);

		process.env.DATA_BACKEND = "dynamodb";
		assert.equal(await checkRelationalStore(), true);
	});

	it("is true when every SQLite file is reachable", async () => {
		dir = mkdtempSync(join(tmpdir(), "remit-health-"));
		const dbPath = join(dir, "mail.db");
		new Database(dbPath).close();

		process.env.DATA_BACKEND = "sqlite";
		pointAt(dbPath, dir);

		assert.equal(await checkRelationalStore(), true);
	});

	it("is false when a database path points at a directory that does not exist", async () => {
		dir = mkdtempSync(join(tmpdir(), "remit-health-"));
		process.env.DATA_BACKEND = "sqlite";
		pointAt("/nonexistent/mail.db", dir);

		assert.equal(await checkRelationalStore(), false);
	});

	it("is false when the SQLite file exists but is unreadable", async () => {
		dir = mkdtempSync(join(tmpdir(), "remit-health-"));
		const dbPath = join(dir, "mail.db");
		new Database(dbPath).close();
		chmodSync(dbPath, 0o000);

		process.env.DATA_BACKEND = "sqlite";
		pointAt(dbPath, dir);

		assert.equal(await checkRelationalStore(), false);
	});

	it("is false when the file is readable but no longer writable", async () => {
		dir = mkdtempSync(join(tmpdir(), "remit-health-"));
		const dbPath = join(dir, "mail.db");
		new Database(dbPath).close();

		process.env.DATA_BACKEND = "sqlite";
		pointAt(dbPath, dir);
		assert.equal(await checkRelationalStore(), true);

		// Readable, not writable: the read-only SELECT ping still opens and
		// succeeds, so without `access(W_OK)` this reports healthy on a store the
		// backend can no longer write to. This is the case the writability check
		// exists to catch — dropping `access()` from pingSqlite fails this test.
		chmodSync(dbPath, 0o400);
		assert.equal(await checkRelationalStore(), false);
	});
});
