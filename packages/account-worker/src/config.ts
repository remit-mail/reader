import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getClient } from "@remit/backend/client";
// Type-only: erased at build, so it carries no runtime dependency on
// @remit/drizzle-service. The value (`createCascadeDeleter`) is loaded
// lazily below, inside the `dataBackend === "postgres"` branch — see the
// comment on `pgCascadeDeleter` for why.
import type { CascadeDeleter } from "@remit/drizzle-service";
import {
	FilterAnchorService,
	FilterService,
	LabelService,
	MessageLabelService,
} from "@remit/remit-electrodb-service";
import { resolveSqsCredentials } from "@remit/sqs-client";
import {
	createStorageService,
	type StorageService,
} from "@remit/storage-service";
import { env } from "expect-env";
import type { CascadeServices } from "./cascade.js";

const remitClient = await getClient();

export const cognitoClient = new CognitoIdentityProviderClient({});
export const sqsClient = new SQSClient({
	credentials: resolveSqsCredentials(),
});

// Cognito + SQS env vars are lazy-evaluated. The fanout worker needs them
// at handler time; the finalize worker imports `cascadeServices` from this
// module but talks to neither Cognito nor SQS, so its Lambda doesn't carry
// the env vars. Eager evaluation here would crash finalize at module load
// (`COGNITO_USER_POOL_ID is not set`) — getters defer the read to the
// fanout-only call sites.
export const getUserPoolId = (): string => env.COGNITO_USER_POOL_ID;
export const getSearchIndexQueueUrl = (): string =>
	env.SQS_QUEUE_URL_SEARCH_INDEX;
export const getImapWorkerQueueUrl = (): string =>
	env.SQS_QUEUE_URL_IMAP_WORKER;
export const getAccountFinalizeQueueUrl = (): string =>
	env.SQS_QUEUE_URL_ACCOUNT_FINALIZE;
export const getAccountPurgeDeleteQueueUrl = (): string =>
	env.SQS_QUEUE_URL_ACCOUNT_PURGE_DELETE;

const graceSecondsRaw = process.env.ACCOUNT_DELETION_GRACE_SECONDS;
export const graceSeconds = graceSecondsRaw
	? Number.parseInt(graceSecondsRaw, 10)
	: 60;

// DDB document client and table name — used by cascade-delete.ts which performs
// raw DDB batch deletes via ElectroDB Entity. This path is DynamoDB-only; when
// DATA_BACKEND=postgres the cascade-delete worker is not exercised.
const buildDdbDocumentClient = (): DynamoDBDocumentClient => {
	const isLocalEnv =
		process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

	if (isLocalEnv) {
		const port = process.env.DYNAMODB_PORT ?? "8000";
		const endpoint = `http://localhost:${port}`;
		const ddbClient = new DynamoDBClient({
			endpoint,
			credentials: {
				accessKeyId: "fakeKey",
				secretAccessKey: "fakeSecretKey",
			},
			region: "local",
		});
		return DynamoDBDocumentClient.from(ddbClient);
	}

	return DynamoDBDocumentClient.from(new DynamoDBClient({}));
};

export const ddbClient = buildDdbDocumentClient();
export const tableName = process.env.DYNAMODB_TABLE_NAME ?? "";

// Filter/FilterAnchor/Label/MessageLabel (RFC 034, Smart Organize) are
// DynamoDB-only today — there is no Postgres/Drizzle schema for them, and no
// API handler constructs them through `remitClient` yet. Built directly off
// the DDB document client already available here rather than threading them
// through `@remit/backend`'s dual-backend `RemitClient`, which has
// nothing to offer for a backend that doesn't exist for this feature.
const ddbServiceConfig = { client: ddbClient, table: tableName };
const filterService = new FilterService(ddbServiceConfig);
const filterAnchorService = new FilterAnchorService(ddbServiceConfig);
const labelService = new LabelService(ddbServiceConfig);
const messageLabelService = new MessageLabelService(ddbServiceConfig);

export const cascadeServices: CascadeServices = {
	accountConfigService: remitClient.accountConfig,
	accountService: remitClient.account,
	addressService: remitClient.address,
	mailboxService: remitClient.mailbox,
	messageService: remitClient.message,
	messageFlagService: remitClient.messageFlag,
	envelopeService: remitClient.envelope,
	outboxMessageService: remitClient.outboxMessage,
	threadMessageService: remitClient.threadMessage,
	mailboxLockService: remitClient.mailboxLock,
	messagePlacementMoveService: remitClient.placementMove,
	messageFlagPushService: remitClient.flagPush,
	accountExportRequestService: remitClient.accountExportRequest,
	accountSettingService: remitClient.accountSetting,
	filterService,
	filterAnchorService,
	labelService,
	messageLabelService,
};

export const accountConfigService = cascadeServices.accountConfigService;

let storageService: StorageService | null = null;
export const getStorageService = (): StorageService => {
	if (!storageService) {
		storageService = createStorageService();
	}
	return storageService;
};

export const dataBackend = process.env.DATA_BACKEND;

// On the Postgres backend the cascade deletes rows through Drizzle instead of
// raw DynamoDB BatchWriteItem. Built once here and reused across invocations;
// left undefined on DynamoDB, where `runCascadeDelete` falls back to DDB.
//
// `@remit/drizzle-service` is loaded lazily (and marked `external` for
// the Lambda esbuild build — see LAMBDA_ESBUILD_OPTIONS). account-worker
// deploys only as an AWS Lambda (unlike remit-backend, which also ships as a
// Scaleway container with DATA_BACKEND=postgres and full node_modules — see
// infra/scaleway/main.tf), so this branch is unreachable in every place this
// bundle runs; the lazy import keeps a Postgres client out of the bundle
// (#1244/#1247; #1242 FAQ).
export const pgCascadeDeleter: CascadeDeleter | undefined =
	dataBackend === "postgres"
		? (await import("@remit/drizzle-service")).createCascadeDeleter(
				env.PG_CONNECTION_URL,
			)
		: undefined;
