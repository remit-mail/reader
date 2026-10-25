import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import type {
	AccountResponse,
	AccountService as AccountServiceName,
} from "@remit/api-openapi-types";
import type { AccountItem } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	AccountAuthType,
	AccountService,
	ConnectionState,
} from "@remit/domain-enums";
import {
	type AccountRepo,
	createSqliteRepositories,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { MICROSOFT_SERVICE_SCOPES } from "@remit/mail-oauth-service";
import {
	createSecretsService,
	deserializeEncryptedPayload,
	type SecretsService,
} from "@remit/secrets-service";
import type { Context } from "openapi-backend";
import { handleError } from "../error.js";
import { type FormattedResponse, formatResponse } from "../response.js";
import type { RemitClient } from "../service/data-client.js";
import { sqsClient } from "../service/sqs.js";
import type { HandlerContext } from "../types.js";
import { AccountDetailOperations, AccountOperations } from "./account.js";
import { ConfigOperations } from "./config.js";

let client: RemitClient;

const SUB = "cognito-sub-1180";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);

const getConfig = ConfigOperations.ConfigOperations_getConfig;
const createAccount = AccountOperations.AccountOperations_createAccount;
const updateAccount =
	AccountDetailOperations.AccountDetailOperations_updateAccount;
const deleteAccount =
	AccountDetailOperations.AccountDetailOperations_deleteAccount;

const caller = (): HandlerContext => ({
	client,
	identity: {
		kind: "user",
		accountConfigId: ACCOUNT_CONFIG_ID,
		sub: SUB,
		email: "caller@example.com",
	},
});

const context = (
	params: Record<string, string> = {},
	requestBody?: unknown,
): Context => ({ request: { params, requestBody } }) as unknown as Context;

const respond = async (
	run: () => Promise<unknown>,
): Promise<FormattedResponse> =>
	run().then(
		(body) => formatResponse(body as Record<string, unknown>),
		(error: unknown) => handleError(error),
	);

const bodyOf = <T>(response: FormattedResponse): T =>
	JSON.parse(response.body) as T;

const dataKey = randomBytes(32);
const secrets: SecretsService = createSecretsService({
	generateDataKey: async () => ({ plaintext: dataKey, encrypted: dataKey }),
	decryptDataKey: async () => dataKey,
});

let accounts: AccountRepo;
let close: () => void;
let enqueued: SendMessageCommand[];

const seedAccount = (
	authType: AccountItem["authType"],
	grantedServices: AccountServiceName[] = authType ===
	AccountAuthType.OauthMicrosoft
		? [AccountService.Mail]
		: [],
) =>
	accounts.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		username: `${authType}@example.com`,
		email: `${authType}@example.com`,
		authType,
		grantedScopes: grantedServices.flatMap(
			(service) => MICROSOFT_SERVICE_SCOPES[service],
		),
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.NotAuthenticated,
	});

const readServices = async (accountId: string): Promise<string[]> => {
	const config = bodyOf<{ accounts: AccountResponse[] }>(
		await respond(() => getConfig(context(), caller())),
	);
	const account = config.accounts.find((item) => item.accountId === accountId);
	assert.ok(account, `GET /config lists ${accountId}`);
	return account.syncedServices;
};

const patchServices = (accountId: string, syncedServices: string[]) =>
	respond(() =>
		updateAccount(context({ accountId }, { syncedServices }), caller()),
	);

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
	const repos = createSqliteRepositories({
		app: store.db,
		mail: store.db,
		search: store.db,
	});
	accounts = repos.account;
	await repos.accountConfig.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		userId: SUB,
	});
	client = {
		accountConfig: repos.accountConfig,
		account: accounts,
		accountSetting: repos.accountSetting,
		mailbox: repos.mailbox,
		configImport: repos.configImport,
		secrets,
	} as unknown as RemitClient;
});

afterEach(() => {
	mock.restoreAll();
	close();
});

describe("the services an account syncs", () => {
	it("reads mail for an account that never chose", async () => {
		const account = await seedAccount(AccountAuthType.Password);

		assert.deepEqual(await readServices(account.accountId), [
			AccountService.Mail,
		]);
	});

	it("writes a selection the account can serve and reads it back", async () => {
		const account = await seedAccount(AccountAuthType.OauthMicrosoft);

		const response = await patchServices(account.accountId, [
			AccountService.Mail,
			AccountService.Mail,
		]);

		assert.equal(response.statusCode, 200);
		assert.deepEqual(bodyOf<AccountResponse>(response).syncedServices, [
			AccountService.Mail,
		]);
		assert.deepEqual(await readServices(account.accountId), [
			AccountService.Mail,
		]);
	});

	it("refuses an empty selection and points at deleting the account", async () => {
		const account = await seedAccount(AccountAuthType.OauthMicrosoft);

		const response = await patchServices(account.accountId, []);

		assert.equal(response.statusCode, 400);
		assert.match(
			bodyOf<{ message: string }>(response).message,
			/DELETE \/accounts\/\{accountId\}/,
		);
		assert.deepEqual(await readServices(account.accountId), [
			AccountService.Mail,
		]);
	});

	it("refuses calendar on a password account", async () => {
		const account = await seedAccount(AccountAuthType.Password);

		const response = await patchServices(account.accountId, [
			AccountService.Mail,
			AccountService.Calendar,
		]);

		assert.equal(response.statusCode, 400);
		assert.match(
			bodyOf<{ message: string }>(response).message,
			/password account syncs mail only/,
		);
		assert.deepEqual(await readServices(account.accountId), [
			AccountService.Mail,
		]);
	});

	it("accepts calendar once the granted scopes cover it", async () => {
		const account = await seedAccount(AccountAuthType.OauthMicrosoft, [
			AccountService.Mail,
			AccountService.Calendar,
		]);

		const response = await patchServices(account.accountId, [
			AccountService.Calendar,
		]);

		assert.equal(response.statusCode, 200);
		assert.deepEqual(await readServices(account.accountId), [
			AccountService.Calendar,
		]);
	});

	it("refuses calendar the Microsoft consent never covered and names the consent route", async () => {
		const account = await seedAccount(AccountAuthType.OauthMicrosoft);

		const response = await patchServices(account.accountId, [
			AccountService.Calendar,
		]);

		assert.equal(response.statusCode, 400);
		const { message } = bodyOf<{ message: string }>(response);
		assert.match(message, /granted scopes lack Calendar/);
		assert.match(message, /POST \/accounts\/oauth\/microsoft\/start/);
		assert.deepEqual(await readServices(account.accountId), [
			AccountService.Mail,
		]);
	});

	it("refuses to create a password account that syncs calendar", async () => {
		const response = await respond(() =>
			createAccount(
				context(
					{},
					{
						email: "person@example.com",
						password: "hunter2",
						imapHost: "imap.example.com",
						imapPort: 993,
						imapTls: true,
						imapStartTls: false,
						syncedServices: [AccountService.Calendar],
					},
				),
				caller(),
			),
		);

		assert.equal(response.statusCode, 400);
		assert.deepEqual(
			await accounts.listAllByAccountConfig(ACCOUNT_CONFIG_ID),
			[],
		);
	});
});

const listedAccountIds = async (): Promise<string[]> =>
	bodyOf<{ accounts: AccountResponse[] }>(
		await respond(() => getConfig(context(), caller())),
	).accounts.map((account) => account.accountId);

describe("DELETE /accounts/{accountId}", () => {
	it("stores the account as deleted and takes it off GET /config", async () => {
		const account = await seedAccount(AccountAuthType.Password);
		assert.deepEqual(await listedAccountIds(), [account.accountId]);

		const response = await respond(() =>
			deleteAccount(context({ accountId: account.accountId }), caller()),
		);

		assert.equal(response.statusCode, 200);
		const { deletedAt } = bodyOf<{ deletedAt: number }>(response);
		const stored = await accounts.get(account.accountId);
		assert.equal(stored.deletedAt, deletedAt);
		assert.equal(stored.isActive, false);
		assert.equal(enqueued.length, 1);
		assert.deepEqual(await listedAccountIds(), []);
	});
});

describe("PATCH /accounts/{accountId}", () => {
	it("stores a new SMTP password", async () => {
		const account = await seedAccount(AccountAuthType.Password);

		const response = await respond(() =>
			updateAccount(
				context(
					{ accountId: account.accountId },
					{ smtpPassword: "smtp-secret" },
				),
				caller(),
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
