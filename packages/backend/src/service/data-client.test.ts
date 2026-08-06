import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	_resetForTest,
	getClient,
	type RemitClient,
	setClient,
} from "./data-client.js";

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
	"search",
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

const withSqliteDbPath = async (run: () => Promise<void>): Promise<void> => {
	const saved = process.env.SQLITE_DB_PATH;
	const dir = mkdtempSync(join(tmpdir(), "remit-data-client-"));
	process.env.SQLITE_DB_PATH = join(dir, "remit.db");
	try {
		await run();
	} finally {
		_resetForTest();
		if (saved === undefined) delete process.env.SQLITE_DB_PATH;
		else process.env.SQLITE_DB_PATH = saved;
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
	const saved = process.env.SQLITE_DB_PATH;
	delete process.env.SQLITE_DB_PATH;

	try {
		await assert.rejects(getClient(), /register one with setClient\(\)/);
	} finally {
		if (saved !== undefined) process.env.SQLITE_DB_PATH = saved;
	}
});

test("getClient() returns the injected client without reading the environment", async () => {
	const saved = process.env.SQLITE_DB_PATH;
	delete process.env.SQLITE_DB_PATH;

	const injected = { account: {} } as unknown as RemitClient;
	setClient(injected);

	try {
		const client = await getClient();
		assert.equal(client, injected);
	} finally {
		_resetForTest();
		if (saved !== undefined) process.env.SQLITE_DB_PATH = saved;
	}
});
