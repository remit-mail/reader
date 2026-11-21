import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import type {
	ClassificationConfigured,
	ClassificationDefaultResponse,
	UserSettingsResponse,
} from "@remit/api-openapi-types";
import type { ClassificationDeploymentDefault } from "@remit/data-ports/classification-presets";
import { ConflictError } from "@remit/data-ports/errors";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { ClassificationPresetId } from "@remit/domain-enums";
import {
	createSqliteRepositories,
	messageObjectsInMemory,
	NODE_SQLITE_LIMITS,
} from "@remit/drizzle-service";
import {
	createShippedSqliteDb,
	sharedDatabases,
} from "@remit/drizzle-service/test-sqlite";
import { createSecretsService } from "@remit/secrets-service";
import type { Context } from "openapi-backend";
import { testApiConfig } from "../config/test-config.js";
import { handleError } from "../error.js";
import { formatResponse } from "../response.js";
import type {
	ClassificationDefaultStore,
	RemitClient,
} from "../service/create-remit-client.js";
import type { QueueName } from "../service/queues.js";
import type { HandlerContext } from "../types.js";
import { ClassificationDefaultOperations } from "./classification-default.js";
import { UserSettingsOperations } from "./user-settings.js";

const SUB = "classification-default-sub-1676";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const OPERATOR_KEY = "operator-key-that-must-never-leave-the-server";

const context = (requestBody?: unknown): Context =>
	({ request: { params: {}, requestBody } }) as unknown as Context;

describe("the operator classification default", () => {
	it("keeps tenant precedence and keys private while enforcing the host policy", async () => {
		const database = createShippedSqliteDb();
		const repositories = createSqliteRepositories(
			sharedDatabases(database),
			NODE_SQLITE_LIMITS,
			messageObjectsInMemory(),
		);
		try {
			await repositories.accountConfig.create({
				accountConfigId: ACCOUNT_CONFIG_ID,
				userId: SUB,
			});

			const configured: ClassificationDeploymentDefault = {
				state: "Configured",
				presetId: ClassificationPresetId.Jev,
				model: "config-model",
				baseUrl: "https://config.example/v1",
				apiKey: "config-key-that-must-never-leave-the-server",
				enabled: false,
				dailyLimit: 20,
			};
			let operatorValue: ClassificationDeploymentDefault | null = null;
			const store: ClassificationDefaultStore = {
				get: async () =>
					operatorValue === null
						? { value: configured, source: "Config" }
						: { value: operatorValue, source: "Operator" },
				put: async (value) => {
					operatorValue = value;
				},
				delete: async () => {
					operatorValue = null;
				},
			};
			const dataKey = randomBytes(32);
			const secrets = createSecretsService({
				generateDataKey: async () => ({
					plaintext: dataKey,
					encrypted: dataKey,
				}),
				decryptDataKey: async () => dataKey,
			});
			const client = {
				...repositories,
				secrets,
				classificationDefault: store,
				getClassificationDefault: async () => (await store.get()).value,
				spam: {
					spamPipeline: [{ name: "Inline", thresholds: { state: "Unset" } }],
				},
			} as unknown as RemitClient;
			const caller = (
				operator: boolean,
				classificationDefault = store,
			): HandlerContext<QueueName> => ({
				client: { ...client, classificationDefault } as RemitClient,
				config: testApiConfig(),
				operator,
				identity: {
					kind: "user",
					accountConfigId: ACCOUNT_CONFIG_ID,
					sub: SUB,
					email: "operator@example.com",
				},
			});
			const respond = (run: () => Promise<unknown>) =>
				run().then(
					(body) => formatResponse(body as Record<string, unknown>),
					(error: unknown) => handleError(error),
				);

			const forbidden = await respond(() =>
				ClassificationDefaultOperations.ClassificationDefaultOperations_getClassificationDefault(
					context(),
					caller(false),
				),
			);
			assert.equal(forbidden.statusCode, 403);

			const responses = [];
			responses.push(
				await ClassificationDefaultOperations.ClassificationDefaultOperations_getClassificationDefault(
					context(),
					caller(true),
				),
			);
			responses.push(
				await ClassificationDefaultOperations.ClassificationDefaultOperations_putClassificationDefault(
					context({
						presetId: ClassificationPresetId.Jev,
						model: "operator-model",
						baseUrl: "https://operator.example/v1",
						apiKey: OPERATOR_KEY,
						enabled: true,
						dailyLimit: 40,
					}),
					caller(true),
				),
			);
			responses.push(
				await ClassificationDefaultOperations.ClassificationDefaultOperations_putClassificationDefault(
					context({
						presetId: ClassificationPresetId.Jev,
						model: "operator-model-2",
						baseUrl: "https://operator.example/v1",
						apiKey: "",
						enabled: true,
						dailyLimit: 40,
					}),
					caller(true),
				),
			);
			const savedOperator = (await store.get()).value;
			assert.equal(savedOperator.state, "Configured");
			assert.equal(savedOperator.apiKey, OPERATOR_KEY);

			await UserSettingsOperations.UserSettingsOperations_updateUserSettings(
				context({ classificationModel: "tenant-model" }),
				caller(true),
			);
			const settings =
				(await UserSettingsOperations.UserSettingsOperations_getUserSettings(
					context(),
					caller(true),
				)) as UserSettingsResponse;
			assert.equal(settings.classification.state, "Configured");
			const classification =
				settings.classification as ClassificationConfigured;
			assert.equal(classification.model, "tenant-model");
			assert.equal(classification.sources.model, "Saved");
			assert.equal(classification.baseUrl, "https://operator.example/v1");
			assert.equal(classification.sources.baseUrl, "Deployment");

			responses.push(
				await ClassificationDefaultOperations.ClassificationDefaultOperations_deleteClassificationDefault(
					context(),
					caller(true),
				),
			);
			assert.equal(
				(responses.at(-1) as ClassificationDefaultResponse).source,
				"Config",
			);

			const immutable: ClassificationDefaultStore = {
				get: store.get,
				put: async () => {
					throw new ConflictError(
						"The classification default is configured in remit.env.",
					);
				},
				delete: async () => {
					throw new ConflictError(
						"The classification default is configured in remit.env.",
					);
				},
			};
			const selfHosted = await respond(() =>
				ClassificationDefaultOperations.ClassificationDefaultOperations_putClassificationDefault(
					context({
						presetId: ClassificationPresetId.Local,
						model: "",
						baseUrl: "",
						apiKey: "",
						enabled: false,
						dailyLimit: 500,
					}),
					caller(true, immutable),
				),
			);
			assert.equal(selfHosted.statusCode, 409);
			assert.match(selfHosted.body, /remit\.env/);

			for (const response of responses) {
				const json = JSON.stringify(response);
				assert.doesNotMatch(json, /apiKey/);
				assert.doesNotMatch(json, /key-that-must-never-leave/);
			}
		} finally {
			database.close();
		}
	});
});
