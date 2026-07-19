import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
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

afterEach(() => {
	delete process.env.DATA_BACKEND;
});

test("without DATA_BACKEND and no registered ports, throws (DynamoDB path is injected)", async () => {
	await withEnv({ DATA_BACKEND: undefined }, async () => {
		await assert.rejects(
			() => buildDataPortsFromEnv(),
			/no DynamoDB search-index data ports registered/,
		);
	});
});

test("without DATA_BACKEND returns the injected DynamoDB ports", async () => {
	const injected = {
		account: {},
		threadMessage: {},
	} as unknown as SearchIndexDataPorts;
	setSearchIndexDataPorts(injected);
	await withEnv({ DATA_BACKEND: undefined }, async () => {
		const ports = await buildDataPortsFromEnv();
		assert.equal(ports, injected);
	});
});

test("DATA_BACKEND=postgres builds Drizzle ports with a resolveAccountId hook, without connecting", async () => {
	await withEnv(
		{
			DATA_BACKEND: "postgres",
			PG_CONNECTION_URL: "postgresql://remit:remit@localhost:5432/remit_test",
		},
		async () => {
			const ports = await buildDataPortsFromEnv();
			assert.ok(ports.account, "account port must be defined");
			assert.ok(ports.threadMessage, "threadMessage port must be defined");
			assert.equal(
				typeof ports.resolveAccountId,
				"function",
				"the pg outbox relay carries no accountId, so the consumer must derive it",
			);
		},
	);
});

test("DATA_BACKEND=postgres without PG_CONNECTION_URL throws", async () => {
	await withEnv(
		{ DATA_BACKEND: "postgres", PG_CONNECTION_URL: undefined },
		async () => {
			await assert.rejects(() => buildDataPortsFromEnv());
		},
	);
});
