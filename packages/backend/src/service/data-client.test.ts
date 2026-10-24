import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { SQLITE_DATABASE_ENV } from "@remit/drizzle-service";
import { _resetForTest, getClient, type RemitClient } from "./data-client.js";

const REQUIRED_KEYS: ReadonlyArray<keyof RemitClient> = [
	"accountConfig",
	"account",
	"accountSetting",
	"address",
	"mailbox",
	"mailboxSpecialUse",
	"message",
	"messageFlag",
	"outboxMessage",
	"threadMessage",
	"envelope",
	"accountExportRequest",
	"quarantine",
	"storage",
	"secrets",
	"bodySync",
	"flagQueue",
	"mailboxQueue",
	"messageMove",
	"outboxQueue",
	"spamReport",
	"createConnectionScope",
] as const;

afterEach(() => {
	_resetForTest();
});

const DATABASE_ENV = Object.values(SQLITE_DATABASE_ENV);

const withSqliteDbPath = async (run: () => Promise<void>): Promise<void> => {
	const saved = DATABASE_ENV.map((name) => process.env[name]);
	const dir = mkdtempSync(join(tmpdir(), "remit-data-client-"));
	for (const name of DATABASE_ENV) process.env[name] = join(dir, `${name}.db`);
	try {
		await run();
	} finally {
		_resetForTest();
		DATABASE_ENV.forEach((name, index) => {
			const value = saved[index];
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		});
		rmSync(dir, { recursive: true, force: true });
	}
};

test("getClient() falls back to the in-package composition and constructs every service", async () => {
	await withSqliteDbPath(async () => {
		const client = await getClient();

		for (const key of REQUIRED_KEYS) {
			assert.ok(
				client[key] !== undefined && client[key] !== null,
				`RemitClient.${String(key)} must be defined on the fallback path`,
			);
		}

		assert.equal(typeof client.createConnectionScope, "function");
	});
});

test("getClient() names setClient when nothing is registered and there is no database to open", async () => {
	const saved = process.env.SQLITE_APP_DB_PATH;
	delete process.env.SQLITE_APP_DB_PATH;

	try {
		await assert.rejects(getClient(), /register one with setClient\(\)/);
	} finally {
		if (saved !== undefined) process.env.SQLITE_APP_DB_PATH = saved;
	}
});
