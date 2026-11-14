import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, afterEach, beforeEach, describe, it } from "node:test";
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
	createSqliteRepositories,
	messageObjectsInMemory,
	NODE_SQLITE_LIMITS,
	type SqliteRepositories,
} from "@remit/drizzle-service";
import {
	createShippedSqliteDb,
	sharedDatabases,
} from "@remit/drizzle-service/test-sqlite";
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
import { captureStdout, restoreStdout } from "../stdout-capture-fixture.js";
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
		spam: {
			spamPipeline: [{ name: "Inline", thresholds: { state: "Unset" } }],
		},
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

const savedNames = async () =>
	(await classificationRows()).map((row) => row.name).sort();

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
		sharedDatabases(store),
		NODE_SQLITE_LIMITS,
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

after(() => {
	restoreStdout();
});

describe("a saved classification provider", () => {
	it("reads back with classification off", async () => {
		const saved = await saveJev();

		assert.equal(saved.statusCode, 200);
		assert.deepEqual(await configured(), {
			state: "Configured",
			presetId: ClassificationPresetId.Jev,
			model: "jev-latest",
			baseUrl: "https://api.typesafe.ai",
			enabled: false,
			dailyLimit: 500,
			sources: {
				presetId: "Saved",
				model: "Default",
				baseUrl: "Default",
				apiKey: "Saved",
				enabled: "Default",
				dailyLimit: "Default",
			},
			usage: [],
		});
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
		assert.equal(now.sources.apiKey, "Default");
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

	it("keeps the preset and replaces the stored key on a new key", async () => {
		await saveJev();
		const keyBefore = await storedKey();

		const rekeyed = await patch({ classificationApiKey: "sk-jev-rotated" });

		assert.equal(rekeyed.statusCode, 200);
		const now = await configured();
		assert.equal(now.presetId, ClassificationPresetId.Jev);
		assert.equal(now.sources.apiKey, "Saved");
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
	const INHERITED: ClassificationConfigured["sources"] = {
		presetId: "Deployment",
		model: "Deployment",
		baseUrl: "Deployment",
		apiKey: "Deployment",
		enabled: "Deployment",
		dailyLimit: "Deployment",
	};

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

	it("reads back for an account config with no rows, every field inherited, without its key", async () => {
		const settings = await read();

		assert.deepEqual(settings.classification, {
			state: "Configured",
			presetId: ClassificationPresetId.Mistral,
			model: "mistral-small-latest",
			baseUrl: "https://mistral.example/v1",
			enabled: true,
			dailyLimit: 40,
			sources: INHERITED,
			usage: [],
		});
		assert.doesNotMatch(JSON.stringify(settings), new RegExp(DEPLOYMENT_KEY));
	});

	it("overrides the model alone and inherits it again when it is saved blank", async () => {
		const overridden = await patch({ classificationModel: "mistral-large" });

		assert.equal(overridden.statusCode, 200, overridden.body);
		const now = await configured();
		assert.equal(now.model, "mistral-large");
		assert.deepEqual(now.sources, {
			...INHERITED,
			presetId: "Saved",
			model: "Saved",
		});
		assert.deepEqual(await savedNames(), [
			"ClassificationModel",
			"ClassificationPresetId",
		]);

		const blanked = await patch({ classificationModel: "" });

		assert.equal(blanked.statusCode, 200, blanked.body);
		const after = await configured();
		assert.equal(after.model, "mistral-small-latest");
		assert.deepEqual(after.sources, { ...INHERITED, presetId: "Saved" });
		assert.deepEqual(await savedNames(), ["ClassificationPresetId"]);
	});

	it("inherits the base URL again when it is saved blank", async () => {
		await patch({
			classificationBaseUrl: "https://own.example/v1",
			classificationApiKey: "sk-own",
		});

		const blanked = await patch({ classificationBaseUrl: "" });

		assert.equal(blanked.statusCode, 200, blanked.body);
		const now = await configured();
		assert.equal(now.baseUrl, "https://mistral.example/v1");
		assert.equal(now.sources.baseUrl, "Deployment");
		assert.deepEqual(await savedNames(), [
			"ClassificationApiKey",
			"ClassificationPresetId",
		]);
	});

	it("turns classification on and sets a daily limit with no saved provider", async () => {
		classificationDefault = {
			state: "Configured",
			presetId: ClassificationPresetId.Mistral,
			model: "mistral-small-latest",
			baseUrl: "https://mistral.example/v1",
			apiKey: DEPLOYMENT_KEY,
			enabled: false,
			dailyLimit: 40,
		};

		const answered = await patch({
			classificationEnabled: true,
			classificationDailyLimit: 12,
		});

		assert.equal(answered.statusCode, 200, answered.body);
		const now = await configured();
		assert.equal(now.enabled, true);
		assert.equal(now.dailyLimit, 12);
		assert.deepEqual(now.sources, {
			...INHERITED,
			enabled: "Saved",
			dailyLimit: "Saved",
		});
		assert.deepEqual(await savedNames(), [
			"ClassificationDailyLimit",
			"ClassificationEnabled",
		]);
	});

	it("refuses another base URL than the deployment's without a key, and stores nothing", async () => {
		const refused = await patch({
			classificationBaseUrl: "https://own.example/v1",
		});

		assert.equal(refused.statusCode, 400);
		assert.match(refused.body, /classification_api_key_required/);
		assert.deepEqual(await classificationRows(), []);
	});

	it("saves another base URL than the deployment's with the reader's own key", async () => {
		const saved = await patch({
			classificationBaseUrl: "https://own.example/v1",
			classificationApiKey: "sk-own",
		});

		assert.equal(saved.statusCode, 200, saved.body);
		const now = await configured();
		assert.equal(now.baseUrl, "https://own.example/v1");
		assert.deepEqual(now.sources, {
			...INHERITED,
			presetId: "Saved",
			baseUrl: "Saved",
			apiKey: "Saved",
		});
	});

	it("is inherited in every field again once the saved provider is cleared", async () => {
		await saveJev();
		await patch({ classificationEnabled: false, classificationDailyLimit: 7 });

		const cleared = await clear();

		assert.equal(cleared.statusCode, 200);
		assert.deepEqual(await classificationRows(), []);
		const now = await configured();
		assert.equal(now.presetId, ClassificationPresetId.Mistral);
		assert.deepEqual(now.sources, INHERITED);
	});

	it("applies a saved daily limit while the deployment key is in use", async () => {
		const raised = await patch({ classificationDailyLimit: 900 });

		assert.equal(raised.statusCode, 200, raised.body);
		const now = await configured();
		assert.equal(now.dailyLimit, 900);
		assert.equal(now.sources.dailyLimit, "Saved");
		assert.equal(now.sources.apiKey, "Deployment");
	});

	it("never answers or logs the deployment key", async () => {
		const handler = lambdaHandler(async () => caller().client, testApiConfig());
		const send = (httpMethod: string, path: string, body: unknown) =>
			handler(
				{
					httpMethod,
					path,
					headers: { "content-type": "application/json" },
					requestContext: {
						authorizer: { claims: { sub: SUB, email: "caller@example.com" } },
					},
					body: JSON.stringify(body),
				} as unknown as APIGatewayProxyEvent,
				{ awsRequestId: `req-${httpMethod}` } as LambdaContext,
			);

		const { result, logged } = await captureStdout(async () => [
			await send("GET", "/settings", {}),
			await send("PATCH", "/settings", { classificationDailyLimit: 3 }),
			await send("PATCH", "/settings", {
				classificationBaseUrl: "https://own.example/v1",
			}),
			await send("DELETE", "/settings/classification-provider", {}),
		]);

		assert.deepEqual(
			result.map((answer) => answer.statusCode),
			[200, 200, 400, 200],
		);
		for (const answer of result) {
			assert.doesNotMatch(answer.body, new RegExp(DEPLOYMENT_KEY));
		}
		assert.doesNotMatch(logged, new RegExp(DEPLOYMENT_KEY));
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

describe("a provider that cannot run", () => {
	it("reads back as its own state, not a failure", async () => {
		const handler = lambdaHandler(async () => caller().client, testApiConfig());
		for (const [presetId, reason] of [
			[ClassificationPresetId.Jev, "NoApiKey"],
			[ClassificationPresetId.OpenAiCompatible, "NoBaseUrl"],
		] as const) {
			await repos.accountSetting.upsert({
				accountConfigId: ACCOUNT_CONFIG_ID,
				name: AccountSettingName.ClassificationPresetId,
				value: { kind: "String", value: presetId },
			});

			const result = await handler(
				{
					httpMethod: "GET",
					path: "/settings",
					headers: {},
					requestContext: {
						authorizer: { claims: { sub: SUB, email: "caller@example.com" } },
					},
				} as unknown as APIGatewayProxyEvent,
				{ awsRequestId: `req-unrunnable-${reason}` } as LambdaContext,
			);

			assert.equal(result.statusCode, 200, result.body);
			assert.deepEqual(
				(JSON.parse(result.body) as UserSettingsResponse).classification,
				{ state: "Unrunnable", presetId, reason },
			);
		}
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
		assert.equal(now.sources.apiKey, "Saved");
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
