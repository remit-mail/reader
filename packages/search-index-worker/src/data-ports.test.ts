import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildDataPortsFromEnv } from "./data-ports.js";

// The DynamoDB composition module is stripped from the open-core tree; the
// DynamoDB-path cases skip there and run where the module ships.
const hasDynamoComposition = existsSync(
	fileURLToPath(new URL("./compose-dynamodb.ts", import.meta.url)),
);

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

test(
	"without DATA_BACKEND builds DynamoDB (electrodb) ports and no resolveAccountId hook",
	{ skip: !hasDynamoComposition },
	async () => {
		await withEnv(
			{ DATA_BACKEND: undefined, DYNAMODB_TABLE_NAME: "remit-test" },
			async () => {
				const ports = await buildDataPortsFromEnv();
				assert.ok(ports.account, "account port must be defined");
				assert.ok(ports.threadMessage, "threadMessage port must be defined");
				assert.equal(
					ports.resolveAccountId,
					undefined,
					"DynamoDB messages already carry a real accountId — no resolution hook",
				);
			},
		);
	},
);

test(
	"without DATA_BACKEND and no DYNAMODB_TABLE_NAME throws",
	{ skip: !hasDynamoComposition },
	async () => {
		await withEnv(
			{ DATA_BACKEND: undefined, DYNAMODB_TABLE_NAME: undefined },
			async () => {
				await assert.rejects(() => buildDataPortsFromEnv());
			},
		);
	},
);

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
