import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import type {
	ClassificationConfigured,
	UserSettingsResponse,
} from "@remit/api-openapi-types";
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
import type { RemitClient } from "../service/data-client.js";
import type { QueueName } from "../service/queues.js";
import type { HandlerContext } from "../types.js";
import { PersonSettingsOperations } from "./user-settings.js";

const OPERATOR_SUB = "operator-sub-1677";
const PERSON_SUB = "person-sub-1677";
const CLASSIFIER_KEY = "classifier-key-that-must-never-leave-the-server";

const context = (requestBody?: unknown): Context =>
	({
		request: { params: { userId: PERSON_SUB }, requestBody },
	}) as unknown as Context;

describe("an operator managing another person's settings", () => {
	it("writes a key, returns its Saved source without the key, and refuses a non-operator", async () => {
		const database = createShippedSqliteDb();
		const repositories = createSqliteRepositories(
			sharedDatabases(database),
			NODE_SQLITE_LIMITS,
			messageObjectsInMemory(),
		);
		try {
			await repositories.accountConfig.create({
				accountConfigId: deriveAccountConfigId(PERSON_SUB),
				userId: PERSON_SUB,
			});
			const dataKey = randomBytes(32);
			const client = {
				...repositories,
				secrets: createSecretsService({
					generateDataKey: async () => ({
						plaintext: dataKey,
						encrypted: dataKey,
					}),
					decryptDataKey: async () => dataKey,
				}),
				getClassificationDefault: async () => ({ state: "None" }),
				spam: {
					spamPipeline: [{ name: "Inline", thresholds: { state: "Unset" } }],
				},
			} as unknown as RemitClient;
			const caller = (operator: boolean): HandlerContext<QueueName> => ({
				client,
				config: testApiConfig(),
				operator,
				identity: {
					kind: "user",
					accountConfigId: deriveAccountConfigId(OPERATOR_SUB),
					sub: OPERATOR_SUB,
					email: "operator@example.com",
				},
			});

			const updated =
				await PersonSettingsOperations.PersonSettingsOperations_updatePersonSettings(
					context({
						classificationPresetId: ClassificationPresetId.Jev,
						classificationApiKey: CLASSIFIER_KEY,
					}),
					caller(true),
				);
			const read =
				(await PersonSettingsOperations.PersonSettingsOperations_getPersonSettings(
					context(),
					caller(true),
				)) as UserSettingsResponse;
			assert.equal(read.classification.state, "Configured");
			assert.equal(
				(read.classification as ClassificationConfigured).sources.apiKey,
				"Saved",
			);
			for (const response of [updated, read]) {
				const json = JSON.stringify(response);
				assert.doesNotMatch(json, /classificationApiKey/);
				assert.doesNotMatch(json, /classifier-key-that-must-never-leave/);
			}

			const forbidden = await Promise.resolve(
				PersonSettingsOperations.PersonSettingsOperations_getPersonSettings(
					context(),
					caller(false),
				),
			).catch(handleError);
			assert.equal(forbidden.statusCode, 403);
		} finally {
			database.close();
		}
	});
});
