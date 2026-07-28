import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildDataPortsFromEnv,
	type SearchIndexDataPorts,
	setSearchIndexDataPorts,
} from "./data-ports.js";

const withEnv = async (
	overrides: Record<string, string | undefined>,
	fn: () => Promise<void>,
): Promise<void> => {
	const saved: Record<string, string | undefined> = {};
	for (const key of Object.keys(overrides)) saved[key] = process.env[key];
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		await fn();
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
};

test("with neither a registration nor a database, the error names setSearchIndexDataPorts", async () => {
	await withEnv({ SQLITE_DB_PATH: undefined }, async () => {
		await assert.rejects(
			() => buildDataPortsFromEnv(),
			/no search-index data ports registered/,
		);
	});
});

test("SQLITE_DB_PATH builds Drizzle ports with a resolveAccountId hook", async () => {
	const dir = mkdtempSync(join(tmpdir(), "remit-search-ports-"));
	await withEnv({ SQLITE_DB_PATH: join(dir, "remit.db") }, async () => {
		const ports = await buildDataPortsFromEnv();
		assert.ok(ports.account, "account port must be defined");
		assert.ok(ports.threadMessage, "threadMessage port must be defined");
		assert.equal(
			typeof ports.resolveAccountId,
			"function",
			"the outbox relay carries no accountId, so the consumer must derive it",
		);
	});
	rmSync(dir, { recursive: true, force: true });
});

// Last: the registration is process-wide and takes precedence over everything
// below it, so a test registering ports cannot run before the ones that must
// reach the fallback.
test("a registered set of ports is returned without reading the environment", async () => {
	const injected = {
		account: {},
		threadMessage: {},
	} as unknown as SearchIndexDataPorts;
	setSearchIndexDataPorts(injected);
	await withEnv({ SQLITE_DB_PATH: undefined }, async () => {
		const ports = await buildDataPortsFromEnv();
		assert.equal(ports, injected);
	});
});
