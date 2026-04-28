import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { SQSClient } from "@aws-sdk/client-sqs";
import {
	AccountConfigService,
	AccountService,
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
import { env } from "expect-env";
import type { CascadeServices } from "./cascade.js";

export const ddbClient = getClient();
export const tableName = env.DYNAMODB_TABLE_NAME;
const serviceConfig = { client: ddbClient, table: tableName };

export const cognitoClient = new CognitoIdentityProviderClient({});
export const sqsClient = new SQSClient({});

export const userPoolId = env.COGNITO_USER_POOL_ID;
export const searchIndexQueueUrl = env.SQS_QUEUE_URL_SEARCH_INDEX;
export const imapWorkerQueueUrl = env.SQS_QUEUE_URL_IMAP_WORKER;
export const accountFinalizeQueueUrl = env.SQS_QUEUE_URL_ACCOUNT_FINALIZE;

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
};

export const accountConfigService = cascadeServices.accountConfigService;
