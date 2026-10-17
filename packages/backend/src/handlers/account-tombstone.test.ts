import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { AccountResponse } from "@remit/api-openapi-types";
import { ConnectionState } from "@remit/domain-enums";
import {
	AccountConfigRepo,
	AccountRepo,
	AccountSettingRepo,
	ConfigImportRepo,
	MailboxRepo,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import {
	createSecretsService,
	deserializeEncryptedPayload,
	type SecretsService,
} from "@remit/secrets-service";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import { handleError } from "../error.js";
import { formatResponse } from "../response.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { sqsClient } from "../service/sqs.js";
import { AccountDetailOperations } from "./account.js";
import { ConfigOperations } from "./config.js";

const SUB = "cognito-sub-tombstone";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);

type Handler = (
	context: Context,
	event: APIGatewayProxyEvent,
) => Promise<unknown>;

const getConfig = ConfigOperations.ConfigOperations_getConfig as Handler;
const updateAccount =
	AccountDetailOperations.AccountDetailOperations_updateAccount as Handler;
const deleteAccount =
	AccountDetailOperations.AccountDetailOperations_deleteAccount as Handler;

const event = (body?: unknown): APIGatewayProxyEvent =>
	({
		body: body === undefined ? null : JSON.stringify(body),
		requestContext: { authorizer: { claims: { sub: SUB } } },
	}) as unknown as APIGatewayProxyEvent;

const context = (params: Record<string, string> = {}): Context =>
	({ request: { params } }) as unknown as Context;

const respond = async (
	run: () => Promise<unknown>,
): Promise<APIGatewayProxyResult> =>
	run().then(
		(body) => formatResponse(body as Record<string, unknown>),
		(error: unknown) => handleError(error),
	);

const bodyOf = <T>(response: APIGatewayProxyResult): T =>
	JSON.parse(response.body) as T;

const dataKey = randomBytes(32);
const secrets: SecretsService = createSecretsService({
	generateDataKey: async () => ({ plaintext: dataKey, encrypted: dataKey }),
	decryptDataKey: async () => dataKey,
});

let accounts: AccountRepo;
let close: () => void;
let enqueued: SendMessageCommand[];

const seedAccount = () =>
	accounts.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		username: "person@example.com",
		email: "person@example.com",
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.NotAuthenticated,
	});

const listedAccountIds = async (): Promise<string[]> =>
	bodyOf<{ accounts: AccountResponse[] }>(
		await respond(() => getConfig(context(), event())),
	).accounts.map((account) => account.accountId);

beforeEach(async () => {
	process.env.SQS_QUEUE_URL_ACCOUNT_FANOUT =
		"http://localhost:9324/queue/account-fanout-test";
	enqueued = [];
	mock.method(sqsClient, "send", async (command: SendMessageCommand) => {
		enqueued.push(command);
		return {};
	});
	const store = createShippedSqliteDb();
	close = store.close;
	accounts = new AccountRepo(store.db);
	const accountConfig = new AccountConfigRepo(store.db);
	await accountConfig.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		userId: SUB,
	});
	setClient({
		accountConfig,
		account: accounts,
		accountSetting: new AccountSettingRepo(store.db),
		mailbox: new MailboxRepo(store.db),
		configImport: new ConfigImportRepo(store.db),
		secrets,
	} as unknown as RemitClient);
});

afterEach(() => {
	mock.restoreAll();
	_resetForTest();
	close();
});

describe("DELETE /accounts/{accountId}", () => {
	it("leaves the account stored as deleted", async () => {
		const account = await seedAccount();

		const response = await respond(() =>
			deleteAccount(context({ accountId: account.accountId }), event()),
		);

		assert.equal(response.statusCode, 200);
		const { deletedAt } = bodyOf<{ deletedAt: number }>(response);
		const stored = await accounts.get(account.accountId);
		assert.equal(stored.deletedAt, deletedAt);
		assert.equal(stored.isActive, false);
		assert.equal(enqueued.length, 1);
	});

	it("takes the account off GET /config", async () => {
		const account = await seedAccount();
		assert.deepEqual(await listedAccountIds(), [account.accountId]);

		await respond(() =>
			deleteAccount(context({ accountId: account.accountId }), event()),
		);

		assert.deepEqual(await listedAccountIds(), []);
	});
});

describe("PATCH /accounts/{accountId}", () => {
	it("stores a new SMTP password", async () => {
		const account = await seedAccount();

		const response = await respond(() =>
			updateAccount(
				context({ accountId: account.accountId }),
				event({ smtpPassword: "smtp-secret" }),
			),
		);

		assert.equal(response.statusCode, 200);
		const { smtpPasswordHash } = await accounts.get(account.accountId);
		assert.ok(smtpPasswordHash, "the SMTP password is stored");
		assert.equal(
			await secrets.decrypt(
				deserializeEncryptedPayload(JSON.parse(smtpPasswordHash)),
			),
			"smtp-secret",
		);
	});
});
