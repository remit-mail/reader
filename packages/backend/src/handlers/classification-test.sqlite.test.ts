import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import type {
	ClassificationTestFailed,
	ClassificationTestPassed,
} from "@remit/api-openapi-types";
import {
	type ClassificationDeploymentDefault,
	classificationUsageName,
	utcDateOf,
} from "@remit/data-ports/classification-presets";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	ClassificationFailureKind,
	ClassificationField,
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
	type StubHttpServer,
	type StubReply,
	startStubHttpServer,
} from "@remit/mailbox-service/test-helpers/stub-http-server";
import {
	createSecretsService,
	type SecretsService,
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
import { UserSettingsOperations } from "./user-settings.js";

const SUB = "classification-sub-1529";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const SAVED_KEY = "sk-jev-saved-0123456789";

const dataKey = randomBytes(32);
const secrets: SecretsService = createSecretsService({
	generateDataKey: async () => ({ plaintext: dataKey, encrypted: dataKey }),
	decryptDataKey: async () => dataKey,
});

let repos: SqliteRepositories;
let close: () => void;
let provider: StubHttpServer;
let reply: StubReply;
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

const testProvider = (input: Record<string, unknown>): Promise<Answer> =>
	respond(() =>
		UserSettingsOperations.UserSettingsOperations_testClassificationProvider(
			context(input),
			caller(),
		),
	);

const jevForm = (apiKey: string) => ({
	presetId: ClassificationPresetId.Jev,
	model: "",
	baseUrl: provider.baseUrl,
	apiKey,
});

const classificationRows = async () =>
	(await repos.accountSetting.listByAccountConfig(ACCOUNT_CONFIG_ID))
		.filter((row) => row.name.startsWith("Classification"))
		.map(({ name, value, updatedAt }) => ({ name, value, updatedAt }));

const sentAuthorization = (): string | undefined =>
	provider.requests.at(-1)?.headers.authorization;

beforeEach(async () => {
	const store = createShippedSqliteDb();
	close = store.close;
	classificationDefault = { state: "None" };
	repos = createSqliteRepositories(
		sharedDatabases(store.db),
		NODE_SQLITE_LIMITS,
		messageObjectsInMemory(),
	);
	await repos.accountConfig.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		userId: SUB,
	});
	reply = {
		status: 200,
		body: JSON.stringify({
			model: "jev-2026-10",
			answers: {
				label: {
					type: "choice",
					choice: "Newsletter",
					confidence: 0.91,
					probabilities: { Newsletter: 0.91, Personal: 0.04 },
				},
			},
			usage: { input_tokens: 180, output_tokens: 1 },
		}),
	};
	provider = await startStubHttpServer(() => reply);
});

afterEach(async () => {
	await provider.close();
	close();
});

after(() => {
	restoreStdout();
});

describe("a classification test", () => {
	it("passes with the label and latency, and leaves saved settings and the switch as they were", async () => {
		await patch({
			classificationPresetId: ClassificationPresetId.Jev,
			classificationApiKey: SAVED_KEY,
			classificationEnabled: true,
		});
		const before = await classificationRows();

		const answered = await testProvider(jevForm(""));

		assert.equal(answered.statusCode, 200, answered.body);
		const passed: ClassificationTestPassed = JSON.parse(answered.body);
		assert.equal(passed.state, "Passed");
		assert.equal(passed.label, "Newsletter");
		assert.equal(passed.confidence, 0.91);
		assert.ok(passed.latencyMs >= 0);
		assert.deepEqual(await classificationRows(), before);
	});

	it("leaves every daily count as it was", async () => {
		await patch({
			classificationPresetId: ClassificationPresetId.Jev,
			classificationApiKey: SAVED_KEY,
			classificationEnabled: true,
		});
		const usageName = classificationUsageName("1".repeat(25));
		await repos.accountSetting.upsert({
			accountConfigId: ACCOUNT_CONFIG_ID,
			name: usageName,
			value: {
				kind: "DailyCount",
				value: { date: utcDateOf(Date.now()), calls: 7 },
			},
		});
		const before = await repos.accountSetting.get(ACCOUNT_CONFIG_ID, usageName);

		const answered = await testProvider(jevForm(""));

		assert.equal(answered.statusCode, 200, answered.body);
		assert.equal(provider.requests.length, 1);
		assert.deepEqual(
			await repos.accountSetting.get(ACCOUNT_CONFIG_ID, usageName),
			before,
		);
	});

	it("with an empty key field sends the saved key", async () => {
		await patch({
			classificationPresetId: ClassificationPresetId.Jev,
			classificationApiKey: SAVED_KEY,
		});

		await testProvider(jevForm(""));

		assert.equal(sentAuthorization(), `Bearer ${SAVED_KEY}`);
	});

	it("with a key in the form sends that key and saves nothing", async () => {
		await patch({
			classificationPresetId: ClassificationPresetId.Jev,
			classificationApiKey: SAVED_KEY,
		});
		const before = await classificationRows();

		await testProvider(jevForm("sk-jev-typed"));

		assert.equal(sentAuthorization(), "Bearer sk-jev-typed");
		assert.deepEqual(await classificationRows(), before);
	});

	it("answers a failure with its status, kind and field", async () => {
		reply = { status: 401, body: JSON.stringify({ error: "bad key" }) };

		const answered = await testProvider(jevForm("sk-jev-wrong"));

		assert.equal(answered.statusCode, 200, answered.body);
		const failed: ClassificationTestFailed = JSON.parse(answered.body);
		assert.equal(failed.state, "Failed");
		assert.equal(failed.status, 401);
		assert.equal(failed.kind, ClassificationFailureKind.Unauthorized);
		assert.equal(failed.field, ClassificationField.ApiKey);
		assert.deepEqual(await classificationRows(), []);
	});

	it("is refused with 400 when the preset needs a key and none is typed or saved", async () => {
		const answered = await testProvider(jevForm(""));

		assert.equal(answered.statusCode, 400);
		assert.match(answered.body, /classificationApiKey/);
		assert.equal(provider.requests.length, 0);
	});
});

describe("a classification test under a deployment default", () => {
	const DEPLOYMENT_KEY = "sk-deployment-0123456789";

	beforeEach(() => {
		classificationDefault = {
			state: "Configured",
			presetId: ClassificationPresetId.Jev,
			model: "jev-latest",
			baseUrl: provider.baseUrl,
			apiKey: DEPLOYMENT_KEY,
			enabled: true,
			dailyLimit: 40,
		};
	});

	it("with an empty key sends the deployment key for the same preset and base URL, without answering or logging it", async () => {
		for (const baseUrl of [provider.baseUrl, ""]) {
			const { result, logged } = await captureStdout(() =>
				testProvider({ ...jevForm(""), baseUrl }),
			);

			assert.equal(result.statusCode, 200, result.body);
			assert.equal(sentAuthorization(), `Bearer ${DEPLOYMENT_KEY}`);
			assert.doesNotMatch(result.body, new RegExp(DEPLOYMENT_KEY));
			assert.doesNotMatch(logged, new RegExp(DEPLOYMENT_KEY));
		}
	});

	it("with an empty key is refused for another base URL, and calls nobody", async () => {
		const answered = await testProvider({
			...jevForm(""),
			baseUrl: `${provider.baseUrl}/other`,
		});

		assert.equal(answered.statusCode, 400);
		assert.match(answered.body, /classification_api_key_required/);
		assert.equal(provider.requests.length, 0);
	});

	it("with an empty key is refused for another preset, and calls nobody", async () => {
		const answered = await testProvider({
			presetId: ClassificationPresetId.Mistral,
			model: "",
			baseUrl: provider.baseUrl,
			apiKey: "",
		});

		assert.equal(answered.statusCode, 400);
		assert.match(answered.body, /classification_api_key_required/);
		assert.equal(provider.requests.length, 0);
	});
});

describe("a classification test without a session", () => {
	it("answers 401", async () => {
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

		const result = await handler(
			{
				httpMethod: "POST",
				path: "/settings/classification-test",
				headers: { "content-type": "application/json" },
				requestContext: {},
				body: JSON.stringify(jevForm("")),
			} as unknown as APIGatewayProxyEvent,
			{ awsRequestId: "req-classification-test" } as LambdaContext,
		);

		assert.equal(result.statusCode, 401);
		assert.equal(provider.requests.length, 0);
	});
});
