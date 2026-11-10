import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type {
	ClassificationConfigured,
	UserSettingsResponse,
} from "@remit/api-openapi-types";
import type { ClassificationDeploymentDefault } from "@remit/data-ports/classification-presets";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	AccountSettingName,
	ClassificationPresetId,
} from "@remit/domain-enums";
import {
	BETTER_SQLITE3_LIMITS,
	createSqliteRepositories,
	messageObjectsInMemory,
	type SqliteRepositories,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import {
	createSecretsService,
	deserializeEncryptedPayload,
	type SecretsService,
	type SerializedEncryptedPayload,
} from "@remit/secrets-service";
import type {
	APIGatewayProxyEvent,
	Context as LambdaContext,
} from "aws-lambda";
import type { Context } from "openapi-backend";
import { lambdaHandler } from "../api-fixture.js";
import { testApiConfig } from "../config/test-config.js";
import { handleError } from "../error.js";
import { formatResponse } from "../response.js";
import type { RemitClient } from "../service/data-client.js";
import type { QueueName } from "../service/queues.js";
import type { HandlerContext } from "../types.js";
import { ConfigOperations } from "./config.js";
import { UserSettingsOperations } from "./user-settings.js";

const SUB = "classification-sub-1528";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const JEV_KEY = "sk-jev-0123456789abcdef";

const dataKey = randomBytes(32);
const secrets: SecretsService = createSecretsService({
	generateDataKey: async () => ({ plaintext: dataKey, encrypted: dataKey }),
	decryptDataKey: async () => dataKey,
});

let repos: SqliteRepositories;
let close: () => void;
let classificationDefault: ClassificationDeploymentDefault;

const caller = (): HandlerContext<QueueName> => ({
	client: {
		...repos,
		secrets,
		classificationDefault,
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

interface Answer {
	statusCode: number;
	body: string;
}

const respond = async (run: () => Promise<unknown>): Promise<Answer> =>
	run().then(
		(body) => formatResponse(body as Record<string, unknown>),
		(error: unknown) => handleError(error),
	);

const patch = (input: Record<string, unknown>): Promise<Answer> =>
	respond(() =>
		UserSettingsOperations.UserSettingsOperations_updateUserSettings(
			context(input),
			caller(),
		),
	);

const clear = (): Promise<Answer> =>
	respond(() =>
		UserSettingsOperations.UserSettingsOperations_clearClassificationProvider(
			context(),
			caller(),
		),
	);

const read = async (): Promise<UserSettingsResponse> =>
	UserSettingsOperations.UserSettingsOperations_getUserSettings(
		context(),
		caller(),
	) as Promise<UserSettingsResponse>;

const configured = async (): Promise<ClassificationConfigured> => {
	const { classification } = await read();
	assert.equal(classification.state, "Configured");
	return classification as ClassificationConfigured;
};

const storedKey = () =>
	repos.accountSetting.get(
		ACCOUNT_CONFIG_ID,
		AccountSettingName.ClassificationApiKey,
	);

const classificationRows = async () =>
	(await repos.accountSetting.listByAccountConfig(ACCOUNT_CONFIG_ID)).filter(
		(row) => row.name.startsWith("Classification"),
	);

const saveJev = (): Promise<Answer> =>
	patch({
		classificationPresetId: ClassificationPresetId.Jev,
		classificationApiKey: JEV_KEY,
	});

beforeEach(async () => {
	const store = createShippedSqliteDb();
	close = store.close;
	classificationDefault = { state: "None" };
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
	mock.timers.reset();
	close();
});

describe("a saved classification provider", () => {
	it("reads back with classification off", async () => {
		const saved = await saveJev();

		assert.equal(saved.statusCode, 200);
		assert.deepEqual(
			{ ...(await configured()), savedAt: 0 },
			{
				state: "Configured",
				presetId: ClassificationPresetId.Jev,
				model: "jev-latest",
				baseUrl: "https://api.typesafe.ai",
				apiKeySaved: true,
				enabled: false,
				dailyLimit: 500,
				savedAt: 0,
				usage: [],
			},
		);
	});

	it("is refused without a key the preset needs, and nothing is stored", async () => {
		const refused = await patch({
			classificationPresetId: ClassificationPresetId.Jev,
		});

		assert.equal(refused.statusCode, 400);
		assert.match(refused.body, /classificationApiKey/);
		assert.deepEqual(await classificationRows(), []);
		assert.equal((await read()).classification.state, "NotConfigured");
	});

	it("reads an empty model back as the preset's default model", async () => {
		await patch({
			classificationPresetId: ClassificationPresetId.Mistral,
			classificationModel: "",
			classificationApiKey: "mistral-key",
		});

		assert.equal((await configured()).model, "ministral-8b-latest");
	});

	it("deletes the old key when another preset is saved", async () => {
		await saveJev();

		const switched = await patch({
			classificationPresetId: ClassificationPresetId.Local,
		});

		assert.equal(switched.statusCode, 200);
		assert.equal(await storedKey(), null);
		const now = await configured();
		assert.equal(now.presetId, ClassificationPresetId.Local);
		assert.equal(now.apiKeySaved, false);
	});

	it("stores the key as ciphertext and never answers with it", async () => {
		const saved = await saveJev();

		assert.doesNotMatch(saved.body, new RegExp(JEV_KEY));
		assert.doesNotMatch(JSON.stringify(await read()), new RegExp(JEV_KEY));
		const row = await storedKey();
		assert.ok(row);
		assert.equal(row.value.kind, "Map");
		assert.doesNotMatch(JSON.stringify(row.value), new RegExp(JEV_KEY));
		assert.equal(
			await secrets.decrypt(
				deserializeEncryptedPayload(
					row.value.value as unknown as SerializedEncryptedPayload,
				),
			),
			JEV_KEY,
		);
	});

	it("keeps the preset and moves the save time on a new key", async () => {
		mock.timers.enable({ apis: ["Date"], now: 1_000 });
		await saveJev();
		const before = await configured();
		const keyBefore = await storedKey();

		mock.timers.tick(5_000);
		const rekeyed = await patch({ classificationApiKey: "sk-jev-rotated" });

		assert.equal(rekeyed.statusCode, 200);
		const after = await configured();
		assert.equal(after.presetId, ClassificationPresetId.Jev);
		assert.equal(after.savedAt, before.savedAt + 5_000);
		assert.notDeepEqual((await storedKey())?.value, keyBefore?.value);
	});

	it("is cleared with every classification setting, so classification is off", async () => {
		await saveJev();
		await patch({ classificationEnabled: true, classificationDailyLimit: 50 });

		const cleared = await clear();

		assert.equal(cleared.statusCode, 200);
		assert.deepEqual(await classificationRows(), []);
		assert.equal((await read()).classification.state, "NotConfigured");
	});
});

describe("a deployment classification default", () => {
	const DEPLOYMENT_KEY = "sk-deployment-0123456789";

	beforeEach(() => {
		classificationDefault = {
			state: "Configured",
			presetId: ClassificationPresetId.Mistral,
			model: "mistral-small-latest",
			baseUrl: "https://mistral.example/v1",
			apiKey: DEPLOYMENT_KEY,
			enabled: true,
			dailyLimit: 40,
		};
	});

	it("reads back for an account config with no rows, without its key", async () => {
		const { createdAt } = await repos.accountConfig.get(ACCOUNT_CONFIG_ID);

		const settings = await read();

		assert.deepEqual(settings.classification, {
			state: "Configured",
			presetId: ClassificationPresetId.Mistral,
			model: "mistral-small-latest",
			baseUrl: "https://mistral.example/v1",
			apiKeySaved: false,
			enabled: true,
			dailyLimit: 40,
			savedAt: createdAt,
			usage: [],
		});
		assert.doesNotMatch(JSON.stringify(settings), new RegExp(DEPLOYMENT_KEY));
	});

	it("turns the inherited switch off and changes the inherited limit", async () => {
		const switchedOff = await patch({ classificationEnabled: false });
		const limited = await patch({ classificationDailyLimit: 9 });

		assert.equal(switchedOff.statusCode, 200);
		assert.equal(limited.statusCode, 200);
		const now = await configured();
		assert.equal(now.presetId, ClassificationPresetId.Mistral);
		assert.equal(now.enabled, false);
		assert.equal(now.dailyLimit, 9);
	});

	it("gives way to a saved limit and switch", async () => {
		await saveJev();
		await patch({ classificationEnabled: false, classificationDailyLimit: 7 });

		const now = await configured();

		assert.equal(now.presetId, ClassificationPresetId.Jev);
		assert.equal(now.baseUrl, "https://api.typesafe.ai");
		assert.equal(now.enabled, false);
		assert.equal(now.dailyLimit, 7);
	});
});

describe("a config export", () => {
	it("carries no classification key, in plain text or as ciphertext", async () => {
		await saveJev();

		const exported = JSON.stringify(
			await ConfigOperations.ConfigOperations_exportConfig(context(), caller()),
		);

		assert.doesNotMatch(exported, new RegExp(JEV_KEY));
		assert.doesNotMatch(exported, /ClassificationApiKey|encryptedDek/);
	});
});

describe("a request naming a preset", () => {
	it("is refused with 400 when the preset id is unknown", async () => {
		const handler = lambdaHandler(async () => caller().client, testApiConfig());

		const result = await handler(
			{
				httpMethod: "PATCH",
				path: "/settings",
				headers: { "content-type": "application/json" },
				requestContext: {
					authorizer: { claims: { sub: SUB, email: "caller@example.com" } },
				},
				body: JSON.stringify({
					classificationPresetId: "Cohere",
					classificationApiKey: JEV_KEY,
				}),
			} as unknown as APIGatewayProxyEvent,
			{ awsRequestId: "req-unknown-preset" } as LambdaContext,
		);

		assert.equal(result.statusCode, 400, result.body);
		assert.deepEqual(await classificationRows(), []);
	});
});

describe("switching classification", () => {
	it("on is refused when no provider is saved", async () => {
		const refused = await patch({ classificationEnabled: true });

		assert.equal(refused.statusCode, 400);
		assert.match(refused.body, /classification_not_configured/);
		assert.deepEqual(await classificationRows(), []);
	});

	it("off with no provider saved stores nothing", async () => {
		const answered = await patch({ classificationEnabled: false });

		assert.equal(answered.statusCode, 200);
		assert.deepEqual(await classificationRows(), []);
	});

	it("off keeps the provider and its key", async () => {
		await saveJev();
		await patch({ classificationEnabled: true });

		await patch({ classificationEnabled: false });

		const now = await configured();
		assert.equal(now.enabled, false);
		assert.equal(now.presetId, ClassificationPresetId.Jev);
		assert.equal(now.apiKeySaved, true);
		assert.ok(await storedKey());
	});
});

describe("without a session", () => {
	it("every classification operation answers 401", async () => {
		const handler = lambdaHandler(
			async () => {
				throw new Error("a refused request must not build a client");
			},
			testApiConfig({
				auth: {
					mode: "BetterAuthJwt",
					signIn: "Enabled",
					selfSignUp: "Enabled",
					contentSigningSecret: "s".repeat(32),
				},
			}),
		);

		for (const [httpMethod, path] of [
			["GET", "/settings"],
			["PATCH", "/settings"],
			["DELETE", "/settings/classification-provider"],
		] as const) {
			const result = await handler(
				{
					httpMethod,
					path,
					headers: {},
					requestContext: {},
					body: JSON.stringify({ classificationEnabled: true }),
				} as unknown as APIGatewayProxyEvent,
				{ awsRequestId: `req-${httpMethod}` } as LambdaContext,
			);

			assert.equal(result.statusCode, 401, `${httpMethod} ${path}`);
		}
	});
});
