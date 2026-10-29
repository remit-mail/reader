import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ConfigDescriptionResponse } from "@remit/api-openapi-types";
import { CONFIG_KIND, CURRENT_SCHEMA_VERSION } from "@remit/config-format";
import { ensureAccountConfig } from "@remit/data-ports/account-config";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import {
	BETTER_SQLITE3_LIMITS,
	createSqliteRepositories,
	messageObjectsInMemory,
	type SqliteRepositories,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import type { Context } from "openapi-backend";
import { testApiConfig } from "../config/test-config.js";
import type { RemitClient } from "../service/data-client.js";
import type { QueueName } from "../service/queues.js";
import type { HandlerContext } from "../types.js";
import { ConfigOperations } from "./config.js";

const SUB = "host-sub-1452";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);

let repos: SqliteRepositories;
let close: () => void;

const caller = (): HandlerContext<QueueName> => ({
	client: {
		...repos,
		queues: { sync: recordingQueue().fifo, accountFanout: recordingQueue() },
	} as unknown as RemitClient,
	config: testApiConfig(),
	identity: {
		kind: "user",
		accountConfigId: ACCOUNT_CONFIG_ID,
		sub: SUB,
		email: "caller@example.com",
	},
});

const context = (requestBody?: unknown): Context =>
	({ request: { params: {}, requestBody } }) as unknown as Context;

const document = {
	kind: CONFIG_KIND,
	schemaVersion: CURRENT_SCHEMA_VERSION,
	generator: {
		app: "reader",
		version: "0.1.0",
		exportedAt: "2026-10-26T09:00:00+01:00",
	},
	provenance: {
		accountConfigId: "0d9c8b7a6e5f4d3cb2a10f9e8",
		instance: "reader.example",
	},
	accountConfig: { name: "Imported" },
	accounts: [],
	labels: [],
	filters: [],
	addressFlags: [],
};

const getConfig = (): Promise<ConfigDescriptionResponse> =>
	ConfigOperations.ConfigOperations_getConfig(context(), caller());

beforeEach(() => {
	const store = createShippedSqliteDb();
	close = store.close;
	repos = createSqliteRepositories(
		{
			app: store.db,
			mail: store.db,
			search: store.db,
		},
		BETTER_SQLITE3_LIMITS,
		messageObjectsInMemory(),
	);
});

afterEach(() => {
	close();
});

describe("the account config an import creates", () => {
	it("is the row every later request reads and writes", async () => {
		const before = await getConfig();

		await ConfigOperations.ConfigOperations_importConfig(
			context({ mode: "apply", onExisting: "abort", document }),
			caller(),
		);
		const after = await getConfig();

		assert.equal(after.accountConfig.name, "Imported");
		assert.equal(
			after.accountConfig.accountConfigId,
			before.accountConfig.accountConfigId,
		);
		assert.equal(after.accountConfig.userId, before.accountConfig.userId);

		const held = await repos.accountConfig.get(ACCOUNT_CONFIG_ID);
		assert.deepEqual(
			await ensureAccountConfig(repos.accountConfig, ACCOUNT_CONFIG_ID),
			held,
		);
		assert.equal(held.userId, ACCOUNT_CONFIG_ID);
	});
});
