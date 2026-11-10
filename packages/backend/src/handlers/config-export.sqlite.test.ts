import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { ClassificationPresetId } from "@remit/domain-enums";
import {
	BETTER_SQLITE3_LIMITS,
	createSqliteRepositories,
	messageObjectsInMemory,
	type SqliteRepositories,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { createSecretsService } from "@remit/secrets-service";
import type { Context } from "openapi-backend";
import { testApiConfig } from "../config/test-config.js";
import type { RemitClient } from "../service/data-client.js";
import type { QueueName } from "../service/queues.js";
import type { HandlerContext } from "../types.js";
import { ConfigOperations } from "./config.js";
import { UserSettingsOperations } from "./user-settings.js";

const SUB = "export-sub-1528";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const API_KEY = "sk-export-0123456789abcdef";

const dataKey = randomBytes(32);
const secrets = createSecretsService({
	generateDataKey: async () => ({ plaintext: dataKey, encrypted: dataKey }),
	decryptDataKey: async () => dataKey,
});

let repos: SqliteRepositories;
let close: () => void;

const caller = (): HandlerContext<QueueName> => ({
	client: { ...repos, secrets } as unknown as RemitClient,
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

beforeEach(async () => {
	const store = createShippedSqliteDb();
	close = store.close;
	repos = createSqliteRepositories(
		{ app: store.db, mail: store.db, search: store.db },
		BETTER_SQLITE3_LIMITS,
		messageObjectsInMemory(),
	);
	await repos.accountConfig.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		userId: SUB,
	});
});

afterEach(() => {
	close();
});

describe("a config export", () => {
	it("carries no classification key, in plain text or as ciphertext", async () => {
		await UserSettingsOperations.UserSettingsOperations_updateUserSettings(
			context({
				classificationPresetId: ClassificationPresetId.Jev,
				classificationApiKey: API_KEY,
			}),
			caller(),
		);

		const exported = JSON.stringify(
			await ConfigOperations.ConfigOperations_exportConfig(context(), caller()),
		);

		assert.doesNotMatch(exported, new RegExp(API_KEY));
		assert.doesNotMatch(exported, /ClassificationApiKey|encryptedDek/);
	});
});
