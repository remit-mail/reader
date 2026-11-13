import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type {
	ClassificationConfigured,
	UserSettingsResponse,
} from "@remit/api-openapi-types";
import { classificationUsageName } from "@remit/data-ports/classification-presets";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	AccountAuthType,
	ClassificationPresetId,
	ConnectionState,
} from "@remit/domain-enums";
import {
	createSqliteRepositories,
	messageObjectsInMemory,
	NODE_SQLITE_LIMITS,
	type SqliteRepositories,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { createSecretsService } from "@remit/secrets-service";
import type {
	APIGatewayProxyEvent,
	Context as LambdaContext,
} from "aws-lambda";
import type { Context } from "openapi-backend";
import { lambdaHandler } from "../api-fixture.js";
import { testApiConfig } from "../config/test-config.js";
import type { RemitClient } from "../service/data-client.js";
import type { QueueName } from "../service/queues.js";
import type { HandlerContext } from "../types.js";
import { UserSettingsOperations } from "./user-settings.js";

const SUB = "classification-sub-1531";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const NOW = Date.UTC(2026, 10, 10, 15, 30);

const dataKey = randomBytes(32);
const secrets = createSecretsService({
	generateDataKey: async () => ({ plaintext: dataKey, encrypted: dataKey }),
	decryptDataKey: async () => dataKey,
});

let repos: SqliteRepositories;
let close: () => void;

const caller = (): HandlerContext<QueueName> => ({
	client: {
		...repos,
		secrets,
		classificationDefault: { state: "None" },
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

const patch = (input: Record<string, unknown>) =>
	UserSettingsOperations.UserSettingsOperations_updateUserSettings(
		context(input),
		caller(),
	);

const usage = async (): Promise<ClassificationConfigured["usage"]> => {
	const { classification } =
		(await UserSettingsOperations.UserSettingsOperations_getUserSettings(
			context(),
			caller(),
		)) as UserSettingsResponse;
	assert.equal(classification.state, "Configured");
	return (classification as ClassificationConfigured).usage;
};

const addAccount = async (email: string): Promise<string> => {
	const account = await repos.account.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		username: email,
		email,
		authType: AccountAuthType.Password,
		passwordHash: '{"ciphertext":"x"}',
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
	});
	return account.accountId;
};

const storeCalls = (accountId: string, date: string, calls: number) =>
	repos.accountSetting.upsert({
		accountConfigId: ACCOUNT_CONFIG_ID,
		name: classificationUsageName(accountId),
		value: { kind: "DailyCount", value: { date, calls } },
	});

beforeEach(async () => {
	const store = createShippedSqliteDb();
	close = store.close;
	repos = createSqliteRepositories(
		{ app: store.db, mail: store.db, search: store.db },
		NODE_SQLITE_LIMITS,
		messageObjectsInMemory(),
	);
	await repos.accountConfig.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		userId: SUB,
	});
	mock.timers.enable({ apis: ["Date"], now: NOW });
});

afterEach(() => {
	mock.timers.reset();
	close();
});

describe("the settings read", () => {
	it("reports today's calls, the limit, the reset time and the cost per mail account", async () => {
		await patch({
			classificationPresetId: ClassificationPresetId.Jev,
			classificationApiKey: "sk-jev-status",
			classificationDailyLimit: 800,
		});
		const busy = await addAccount("busy@example.com");
		const quiet = await addAccount("quiet@example.com");
		const stale = await addAccount("stale@example.com");
		await storeCalls(busy, "2026-11-10", 400);
		await storeCalls(stale, "2026-11-09", 700);

		const rows = new Map((await usage()).map((row) => [row.accountId, row]));

		assert.equal(rows.size, 3);
		assert.deepEqual(rows.get(busy), {
			accountId: busy,
			calls: 400,
			dailyLimit: 800,
			resetsAt: "2026-11-11T00:00:00.000Z",
			cost: { state: "Priced", currency: "USD", amount: 0.0252 },
		});
		for (const accountId of [quiet, stale]) {
			assert.equal(rows.get(accountId)?.calls, 0);
		}
	});

	it("carries no cost for a preset with no price", async () => {
		await patch({ classificationPresetId: ClassificationPresetId.Local });
		const accountId = await addAccount("local@example.com");
		await storeCalls(accountId, "2026-11-10", 12);

		const [row] = await usage();

		assert.equal(row.calls, 12);
		assert.deepEqual(row.cost, { state: "NoPrice" });
	});
});

describe("the settings read without a session", () => {
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
				httpMethod: "GET",
				path: "/settings",
				headers: {},
				requestContext: {},
			} as unknown as APIGatewayProxyEvent,
			{ awsRequestId: "req-classification-status" } as LambdaContext,
		);

		assert.equal(result.statusCode, 401);
	});
});
