import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	AccountConfigService,
	AccountService,
	EnvelopeService,
	MailboxService,
	MailboxSpecialUseService,
	MessageFlagService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import {
	FlagQueueService,
	MailboxQueueService,
	MessageMoveService,
} from "@remit/mailbox-service";
import {
	createCachedDataKeyProvider,
	createKmsDataKeyProvider,
	createSecretsService,
	FAKE_KMS_KEY_ID,
	type SecretsService,
} from "@remit/secrets-service";
import {
	createStorageService,
	type StorageService,
} from "@remit/storage-service";
import { env } from "expect-env";
import { logger } from "../logger.js";

const isLocalEnv =
	process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

const getDocumentClient = (): DynamoDBDocumentClient => {
	if (isLocalEnv) {
		const port = env.DYNAMODB_PORT;
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

	const ddbClient = new DynamoDBClient({});
	return DynamoDBDocumentClient.from(ddbClient);
};

export interface RemitClient {
	// ElectroDB services (reads)
	accountConfig: AccountConfigService;
	account: AccountService;
	mailbox: MailboxService;
	mailboxSpecialUse: MailboxSpecialUseService;
	message: MessageService;
	messageFlag: MessageFlagService;
	threadMessage: ThreadMessageService;
	envelope: EnvelopeService;

	// Storage service
	storage: StorageService;

	// Secrets service (KMS encryption)
	secrets: SecretsService;

	// Queue services (writes with IMAP sync)
	flagQueue: FlagQueueService;
	mailboxQueue: MailboxQueueService;
	messageMove: MessageMoveService;
}

let client: RemitClient | null = null;

export const getClient = (): RemitClient => {
	if (!client) {
		const documentClient = getDocumentClient();
		const table = env.DYNAMODB_TABLE_NAME;
		const salt = process.env.DYNAMODB_PAGINATION_SALT ?? "";
		const config = { client: documentClient, table, salt };

		// ElectroDB services
		const accountConfigService = new AccountConfigService(config);
		const accountService = new AccountService(config);
		const mailboxService = new MailboxService(config);
		const mailboxSpecialUseService = new MailboxSpecialUseService(config);
		const messageService = new MessageService(config);
		const messageFlagService = new MessageFlagService(config);
		const threadMessageService = new ThreadMessageService(config);
		const envelopeService = new EnvelopeService(config);

		// Queue services (SQS_QUEUE_URL required for write operations)
		const sqsQueueUrl = env.SQS_QUEUE_URL;

		// Storage service - auto-selects filesystem or S3 based on env vars
		const storageService = createStorageService();

		// Secrets service - uses KMS in production, fake provider in dev
		const kmsKeyId = process.env.KMS_KEY_ID ?? FAKE_KMS_KEY_ID;
		const dataKeyProvider = createCachedDataKeyProvider(
			createKmsDataKeyProvider(kmsKeyId),
		);
		const secretsService = createSecretsService(dataKeyProvider);

		client = {
			// ElectroDB services (reads)
			accountConfig: accountConfigService,
			account: accountService,
			mailbox: mailboxService,
			mailboxSpecialUse: mailboxSpecialUseService,
			message: messageService,
			messageFlag: messageFlagService,
			threadMessage: threadMessageService,
			envelope: envelopeService,

			// Storage service
			storage: storageService,

			// Secrets service (KMS encryption)
			secrets: secretsService,

			// Queue services (writes with IMAP sync)
			flagQueue: new FlagQueueService({
				messageFlagService,
				messageService,
				threadMessageService,
				sqsQueueUrl,
				logger,
			}),
			mailboxQueue: new MailboxQueueService({
				mailboxService,
				sqsQueueUrl,
				logger,
			}),
			messageMove: new MessageMoveService({
				messageService,
				mailboxService,
				mailboxSpecialUseService,
				threadMessageService,
				sqsQueueUrl,
				logger,
			}),
		};
	}

	return client;
};
