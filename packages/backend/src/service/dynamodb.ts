import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	AccountConfigService,
	AccountExportRequestService,
	AccountService,
	AccountSettingService,
	AddressService,
	EnvelopeService,
	MailboxService,
	MailboxSpecialUseService,
	MessageFlagService,
	MessageService,
	OutboxMessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { logger } from "@remit/remit-logger-lambda";
import {
	BodySyncService,
	createConnection,
	FlagQueueService,
	type IImapConnection,
	MailboxQueueService,
	MessageMoveService,
	OutboxQueueService,
} from "@remit/mailbox-service";
import {
	buildEmbeddingServiceFromEnv,
	buildVectorStoreFromEnv,
	createSearchService,
	type SearchService,
} from "@remit/search-service";
import {
	createCachedDataKeyProvider,
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
	FAKE_KMS_KEY_ID,
	type SecretsService,
} from "@remit/secrets-service";
import {
	createStorageService,
	type StorageService,
} from "@remit/storage-service";
import { env } from "expect-env";

const isLocalEnv =
	process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

// The vector store and embedder are selected from the environment by the shared
// builders: S3 Vectors + Bedrock Titan in production, persistent sqlite-vec +
// Transformers.js when the LOCAL_* / local flags are set (local dev), and the
// in-memory store + deterministic embedder otherwise (tests).
const buildSearchService = (): SearchService => {
	// Build the embedder first so we can pass its dimension count to the
	// sqlite-vec store — the vec0 table dimension must match the embedder.
	const embedder = buildEmbeddingServiceFromEnv();
	return createSearchService({
		store: buildVectorStoreFromEnv(embedder.dimensions),
		embedder,
	});
};

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

export interface ConnectionScope {
	getConnection: () => Promise<IImapConnection>;
	disconnect: () => Promise<void>;
}

export interface RemitClient {
	// ElectroDB services (reads)
	accountConfig: AccountConfigService;
	account: AccountService;
	accountSetting: AccountSettingService;
	address: AddressService;
	mailbox: MailboxService;
	mailboxSpecialUse: MailboxSpecialUseService;
	message: MessageService;
	messageFlag: MessageFlagService;
	outboxMessage: OutboxMessageService;
	threadMessage: ThreadMessageService;
	envelope: EnvelopeService;
	accountExportRequest: AccountExportRequestService;

	// Storage service
	storage: StorageService;

	// Search service (semantic vector search)
	search: SearchService;

	// Secrets service (KMS encryption)
	secrets: SecretsService;

	// Body sync service (on-demand IMAP body fetch)
	bodySync: BodySyncService;

	// Queue services (writes with IMAP sync)
	flagQueue: FlagQueueService;
	mailboxQueue: MailboxQueueService;
	messageMove: MessageMoveService;
	outboxQueue: OutboxQueueService;

	// Helper to create IMAP connection scope from accountId
	createConnectionScope: (accountId: string) => Promise<ConnectionScope>;
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
		const accountSettingService = new AccountSettingService(config);
		const mailboxService = new MailboxService(config);
		const mailboxSpecialUseService = new MailboxSpecialUseService(config);
		const messageService = new MessageService(config);
		const messageFlagService = new MessageFlagService(config);
		const threadMessageService = new ThreadMessageService(config);
		const envelopeService = new EnvelopeService(config);
		const addressService = new AddressService(config);
		const outboxMessageService = new OutboxMessageService(config);
		const accountExportRequestService = new AccountExportRequestService(config);

		// Queue services (SQS_QUEUE_URL required for write operations)
		const sqsQueueUrl = env.SQS_QUEUE_URL;
		const sqsSmtpQueueUrl = process.env.SQS_QUEUE_URL_SMTP ?? sqsQueueUrl;

		// Storage service - auto-selects filesystem or S3 based on env vars
		const storageService = createStorageService();

		// Search service - composes embedder + vector store, both selected from
		// the environment (S3 Vectors + Bedrock in prod, sqlite-vec +
		// Transformers locally, in-memory + deterministic in tests).
		const searchService = buildSearchService();

		// Secrets service - uses KMS in production, fake provider in dev
		const kmsKeyId = process.env.KMS_KEY_ID ?? FAKE_KMS_KEY_ID;
		const dataKeyProvider = createCachedDataKeyProvider(
			createKmsDataKeyProvider(kmsKeyId),
		);
		const secretsService = createSecretsService(dataKeyProvider);

		// Body sync service for on-demand IMAP body fetch.
		const bodySyncService = new BodySyncService(
			messageService,
			storageService,
			threadMessageService,
			addressService,
			envelopeService,
			logger,
		);

		// Helper to create connection scope from accountId
		const createConnectionScopeHelper = async (
			accountId: string,
		): Promise<ConnectionScope> => {
			const account = await accountService.get(accountId);
			if (!account.passwordHash) {
				throw new Error(
					`Account ${accountId} has no passwordHash — OAuth accounts cannot use this connection path`,
				);
			}
			const password = await secretsService.decrypt(
				deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
			);

			let connection: IImapConnection | null = null;
			let connectPromise: Promise<IImapConnection> | null = null;

			const getConnection = async (): Promise<IImapConnection> => {
				if (connectPromise) {
					return connectPromise;
				}

				const conn = createConnection({
					user: account.username,
					credentials: { kind: "password", password },
					host: account.imapHost,
					port: account.imapPort,
					tls: account.imapTls,
				});
				connection = conn;
				connectPromise = conn.connect().then(() => conn);

				return connectPromise;
			};

			const disconnect = async (): Promise<void> => {
				if (connection) {
					await connection.disconnect();
					connection = null;
					connectPromise = null;
				}
			};

			return { getConnection, disconnect };
		};

		client = {
			// ElectroDB services (reads)
			accountConfig: accountConfigService,
			account: accountService,
			accountSetting: accountSettingService,
			address: addressService,
			mailbox: mailboxService,
			mailboxSpecialUse: mailboxSpecialUseService,
			message: messageService,
			messageFlag: messageFlagService,
			outboxMessage: outboxMessageService,
			threadMessage: threadMessageService,
			envelope: envelopeService,
			accountExportRequest: accountExportRequestService,

			// Storage service
			storage: storageService,

			// Search service (semantic vector search)
			search: searchService,

			// Secrets service (KMS encryption)
			secrets: secretsService,

			// Body sync service (on-demand IMAP body fetch)
			bodySync: bodySyncService,

			// Queue services (writes with IMAP sync)
			flagQueue: new FlagQueueService({
				messageFlagService,
				messageService,
				threadMessageService,
				mailboxService,
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
				addressService,
				sqsQueueUrl,
				logger,
			}),
			outboxQueue: new OutboxQueueService({
				outboxMessageService,
				accountService,
				sqsSmtpQueueUrl,
				logger,
			}),

			// Helper to create IMAP connection scope from accountId
			createConnectionScope: createConnectionScopeHelper,
		};
	}

	return client;
};
