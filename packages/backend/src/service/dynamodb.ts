import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	AccountConfigService,
	AccountService,
	AddressService,
	EnvelopeService,
	MailboxService,
	MailboxSpecialUseService,
	MessageFlagService,
	MessageService,
	OutboxMessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
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
	BedrockEmbeddingService,
	createDeterministicEmbeddingService,
	createMemoryVectorStore,
	createS3VectorsBackend,
	createSearchService,
	type SearchService,
	type VectorStoreService,
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
import { logger } from "../logger.js";

const isLocalEnv =
	process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

const buildVectorStore = (): VectorStoreService => {
	const bucket = process.env.S3_VECTORS_BUCKET_NAME;
	const indexName = process.env.S3_VECTORS_INDEX_NAME;
	if (bucket && indexName) {
		return createS3VectorsBackend({
			vectorBucketName: bucket,
			indexName,
			region: process.env.AWS_REGION,
		});
	}
	return createMemoryVectorStore();
};

const buildSearchService = (): SearchService => {
	const store = buildVectorStore();
	const useBedrock = process.env.SEARCH_EMBEDDING_PROVIDER === "bedrock";
	const embedder = useBedrock
		? new BedrockEmbeddingService({
				region: process.env.AWS_REGION,
				modelId: process.env.SEARCH_EMBEDDING_MODEL_ID,
			})
		: createDeterministicEmbeddingService();
	return createSearchService({ store, embedder });
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
	address: AddressService;
	mailbox: MailboxService;
	mailboxSpecialUse: MailboxSpecialUseService;
	message: MessageService;
	messageFlag: MessageFlagService;
	outboxMessage: OutboxMessageService;
	threadMessage: ThreadMessageService;
	envelope: EnvelopeService;

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
		const mailboxService = new MailboxService(config);
		const mailboxSpecialUseService = new MailboxSpecialUseService(config);
		const messageService = new MessageService(config);
		const messageFlagService = new MessageFlagService(config);
		const threadMessageService = new ThreadMessageService(config);
		const envelopeService = new EnvelopeService(config);
		const addressService = new AddressService(config);
		const outboxMessageService = new OutboxMessageService(config);

		// Queue services (SQS_QUEUE_URL required for write operations)
		const sqsQueueUrl = env.SQS_QUEUE_URL;
		const sqsSmtpQueueUrl = process.env.SQS_QUEUE_URL_SMTP ?? sqsQueueUrl;

		// Storage service - auto-selects filesystem or S3 based on env vars
		const storageService = createStorageService();

		// Search service - composes embedder + vector store. The vector store
		// switches to S3 Vectors only when the bucket/index env vars are set;
		// otherwise the in-memory store is used (suitable for local dev / tests).
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
					password,
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
			address: addressService,
			mailbox: mailboxService,
			mailboxSpecialUse: mailboxSpecialUseService,
			message: messageService,
			messageFlag: messageFlagService,
			outboxMessage: outboxMessageService,
			threadMessage: threadMessageService,
			envelope: envelopeService,

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
