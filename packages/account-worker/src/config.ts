import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { SQSClient } from "@aws-sdk/client-sqs";
import {
	AccountConfigService,
	AccountExportRequestService,
	AccountService,
	AccountSettingService,
	AddressService,
	EnvelopeService,
	getClient,
	MailboxLockService,
	MailboxService,
	MessageFlagService,
	MessageService,
	OutboxMessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import {
	createStorageService,
	type StorageService,
} from "@remit/storage-service";
import { env } from "expect-env";
import type { CascadeServices } from "./cascade.js";

export const ddbClient = getClient();
export const tableName = env.DYNAMODB_TABLE_NAME;
const serviceConfig = { client: ddbClient, table: tableName };

export const cognitoClient = new CognitoIdentityProviderClient({});
export const sqsClient = new SQSClient({});

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

export const cascadeServices: CascadeServices = {
	accountConfigService: new AccountConfigService(serviceConfig),
	accountService: new AccountService(serviceConfig),
	addressService: new AddressService(serviceConfig),
	mailboxService: new MailboxService(serviceConfig),
	messageService: new MessageService(serviceConfig),
	envelopeService: new EnvelopeService(serviceConfig),
	messageFlagService: new MessageFlagService(serviceConfig),
	outboxMessageService: new OutboxMessageService(serviceConfig),
	threadMessageService: new ThreadMessageService(serviceConfig),
	mailboxLockService: new MailboxLockService(serviceConfig),
	accountExportRequestService: new AccountExportRequestService(serviceConfig),
	accountSettingService: new AccountSettingService(serviceConfig),
};

export const accountConfigService = cascadeServices.accountConfigService;

let storageService: StorageService | null = null;
export const getStorageService = (): StorageService => {
	if (!storageService) {
		storageService = createStorageService();
	}
	return storageService;
};
