import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type {
	IAccountConfigRepository,
	IAccountExportRequestRepository,
	IAccountRepository,
	IAccountSettingRepository,
	IAddressRepository,
	IEnvelopeRepository,
	IFilterAnchorRepository,
	IFilterRepository,
	ILabelRepository,
	IMailboxLockRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageFlagPushRepository,
	IMessageFlagRepository,
	IMessageLabelRepository,
	IMessagePlacementMoveRepository,
	IMessageRepository,
	IOrganizeJobRequestRepository,
	IOutboxMessageRepository,
	IThreadMessageRepository,
	IUnitOfWork,
} from "@remit/data-ports";
import {
	AccountConfigService,
	AccountExportRequestService,
	AccountService,
	AccountSettingService,
	AddressService,
	EnvelopeService,
	FilterAnchorService,
	FilterService,
	LabelService,
	MailboxLockService,
	MailboxService,
	MailboxSpecialUseService,
	MessageFlagPushService,
	MessageFlagService,
	MessageLabelService,
	MessagePlacementMoveService,
	MessageService,
	OrganizeJobRequestService,
	OutboxMessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { logger } from "@remit/logger-lambda";
import {
	BodySyncQueueService,
	BodySyncService,
	createConnection,
	FlagPushService,
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
// Type-only: erased at build, so it carries no runtime dependency on
// drizzle-orm. The value import lives inside `buildPostgresClient` as a
// dynamic `import()` — see the comment there for why.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
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
	// Data repositories (satisfied by ElectroDB services or Drizzle repos)
	accountConfig: IAccountConfigRepository;
	account: IAccountRepository;
	accountSetting: IAccountSettingRepository;
	address: IAddressRepository;
	mailbox: IMailboxRepository;
	mailboxSpecialUse: IMailboxSpecialUseRepository;
	mailboxLock: IMailboxLockRepository;
	message: IMessageRepository;
	messageFlag: IMessageFlagRepository;
	outboxMessage: IOutboxMessageRepository;
	threadMessage: IThreadMessageRepository;
	envelope: IEnvelopeRepository;
	accountExportRequest: IAccountExportRequestRepository;

	// Smart Organize back-apply job (RFC 034, #1278). Present on both backends,
	// modeled on accountExportRequest — a Pending row the account-fanout worker
	// picks up and drives to Complete/Failed. Never a Filter.
	organizeJobRequest: IOrganizeJobRequestRepository;

	// Smart Organize (RFC 034, epic #1280). Present on both backends
	// (`FilterService`/`LabelService`/… on DynamoDB, `FilterRepo`/`LabelRepo`/…
	// on Postgres) so the matching pipeline and filter CRUD run unchanged on
	// either. The Postgres side has no TTL reaper for expired Temporary filters;
	// match-time correctness gates on `expiresAt` (RFC 034 Decision 1.1), never
	// on the row still existing, so the missing reaper is housekeeping only.
	filter: IFilterRepository;
	filterAnchor: IFilterAnchorRepository;
	label: ILabelRepository;
	messageLabel: IMessageLabelRepository;

	// Atomic write set for a message save. Present on Postgres (real
	// transaction); absent on DynamoDB, where callers fall back to per-repo
	// writes with that backend's own (non-transactional) guarantees.
	unitOfWork?: IUnitOfWork;

	// Storage service
	storage: StorageService;

	// Search service (semantic vector search)
	search: SearchService;

	// Secrets service (KMS encryption)
	secrets: SecretsService;

	// Body sync service (on-demand IMAP body fetch)
	bodySync: BodySyncService;

	// Re-arms the SYNC_MESSAGE_BODY cue when a read-path body fetch finds the
	// storage object missing. Absent when SQS_QUEUE_URL_BODY is not configured
	// (the deployed API Lambda does not carry the body queue today).
	bodySyncQueue?: BodySyncQueueService;

	// Pending placement-move markers (issue #1271). Present on both backends
	// (`MessagePlacementMoveService` on DynamoDB, `MessagePlacementMoveRepo` on
	// Postgres) so a caller never needs to guess which backend is active. Used
	// for read-time count prediction (epic #1281 invariant 4) and by the
	// account-worker cascade delete. Note the asymmetry this does NOT close:
	// markers are only ever WRITTEN by the imap-worker's bulk body-sync path,
	// which is DynamoDB-only (a hardcoded `@remit/remit-electrodb-service`
	// client, not wired through this RemitClient) — there is no
	// Postgres-backed placement producer today, so the Postgres path always
	// returns empty until one exists. This wiring exists so that gap is the
	// only one (no separate "field absent" gap on top of it).
	placementMove: IMessagePlacementMoveRepository;

	// Pending flag-push markers (issue #1273). Present on both backends
	// (`MessageFlagPushService` on DynamoDB, `MessageFlagPushRepo` on
	// Postgres). Used for read-time unseenCount prediction (epic #1281
	// invariant 4), by the account-worker cascade delete, and by the periodic
	// per-mailbox sync tick to re-arm a marker stuck `pending`. Unlike
	// `placementMove`, this one IS written on both backends — `flagQueue`
	// below writes through it regardless of `DATA_BACKEND`.
	flagPush: IMessageFlagPushRepository;

	// Queue services (writes with IMAP sync)
	flagQueue: FlagQueueService;
	mailboxQueue: MailboxQueueService;
	messageMove: MessageMoveService;
	outboxQueue: OutboxQueueService;

	// Helper to create IMAP connection scope from accountId
	createConnectionScope: (accountId: string) => Promise<ConnectionScope>;
}

let clientPromise: Promise<RemitClient> | null = null;

const buildConnectionScope =
	(accountService: IAccountRepository, secretsService: SecretsService) =>
	async (accountId: string): Promise<ConnectionScope> => {
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

// The body queue lives on the worker infra; the API only knows it locally
// (dev / e2e set SQS_QUEUE_URL_BODY). When unset the read path still returns a
// retryable 202 — it just cannot re-arm the cue itself.
const buildBodySyncQueue = (): BodySyncQueueService | undefined => {
	const bodyQueueUrl = process.env.SQS_QUEUE_URL_BODY;
	if (!bodyQueueUrl) return undefined;
	return new BodySyncQueueService({ sqsQueueUrl: bodyQueueUrl, logger });
};

const buildSharedServices = () => {
	const storageService = createStorageService();
	const searchService = buildSearchService();
	const kmsKeyId = process.env.KMS_KEY_ID ?? FAKE_KMS_KEY_ID;
	const dataKeyProvider = createCachedDataKeyProvider(
		createKmsDataKeyProvider(kmsKeyId),
	);
	const secretsService = createSecretsService(dataKeyProvider);
	return { storageService, searchService, secretsService };
};

const buildDynamoDBClient = (): RemitClient => {
	const documentClient = getDocumentClient();
	const table = env.DYNAMODB_TABLE_NAME;
	const salt = process.env.DYNAMODB_PAGINATION_SALT ?? "";
	const config = { client: documentClient, table, salt };

	const accountConfigService = new AccountConfigService(config);
	const accountService = new AccountService(config);
	const accountSettingService = new AccountSettingService(config);
	const mailboxService = new MailboxService(config);
	const mailboxSpecialUseService = new MailboxSpecialUseService(config);
	const mailboxLockService = new MailboxLockService(config);
	const messageService = new MessageService(config);
	const messageFlagService = new MessageFlagService(config);
	const threadMessageService = new ThreadMessageService(config);
	const envelopeService = new EnvelopeService(config);
	const addressService = new AddressService(config);
	const outboxMessageService = new OutboxMessageService(config);
	const accountExportRequestService = new AccountExportRequestService(config);
	const organizeJobRequestService = new OrganizeJobRequestService(config);
	const placementMoveService = new MessagePlacementMoveService(config);
	const flagPushMarkerService = new MessageFlagPushService(config);
	const filterService = new FilterService(config);
	const filterAnchorService = new FilterAnchorService(config);
	const labelService = new LabelService(config);
	const messageLabelService = new MessageLabelService(config);

	const sqsQueueUrl = env.SQS_QUEUE_URL;
	const sqsSmtpQueueUrl = process.env.SQS_QUEUE_URL_SMTP ?? sqsQueueUrl;

	const { storageService, searchService, secretsService } =
		buildSharedServices();

	const bodySyncService = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		addressService,
		envelopeService,
		logger,
	);

	const flagPushService = new FlagPushService({
		markerService: flagPushMarkerService,
		sqsQueueUrl,
		logger,
	});

	return {
		accountConfig: accountConfigService,
		account: accountService,
		accountSetting: accountSettingService,
		address: addressService,
		mailbox: mailboxService,
		mailboxSpecialUse: mailboxSpecialUseService,
		mailboxLock: mailboxLockService,
		message: messageService,
		messageFlag: messageFlagService,
		outboxMessage: outboxMessageService,
		threadMessage: threadMessageService,
		envelope: envelopeService,
		accountExportRequest: accountExportRequestService,
		organizeJobRequest: organizeJobRequestService,
		filter: filterService,
		filterAnchor: filterAnchorService,
		label: labelService,
		messageLabel: messageLabelService,

		storage: storageService,
		search: searchService,
		secrets: secretsService,

		bodySync: bodySyncService,
		bodySyncQueue: buildBodySyncQueue(),
		placementMove: placementMoveService,
		flagPush: flagPushMarkerService,

		flagQueue: new FlagQueueService({
			messageFlagService,
			messageService,
			threadMessageService,
			flagPushService,
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

		createConnectionScope: buildConnectionScope(accountService, secretsService),
	};
};

// `@remit/drizzle-service` and `drizzle-orm/node-postgres` are loaded
// lazily, inside this function, instead of as static top-level imports. This
// branch only ever runs when `DATA_BACKEND === "postgres"` — true for the
// local Postgres-parity dev stack, never on deployed Lambdas — but a static
// import is bundled (and evaluated at module load) regardless of whether the
// branch that uses it ever runs. A `pg.Pool`/drizzle client constructed at
// Lambda cold start on every invocation was exactly the #1244 bundle leak.
// `@remit/drizzle-service` and `drizzle-orm` are marked `external` for
// the Lambda esbuild build (see LAMBDA_ESBUILD_OPTIONS), so esbuild leaves
// this `import()` unresolved in the bundle; it is only ever reached — and
// only ever needs to resolve — on the Postgres path, which runs via `tsx`
// (no bundling, real module resolution) and always has both packages
// installed.
const buildPostgresClient = async (): Promise<RemitClient> => {
	const pgConnectionUrl = env.PG_CONNECTION_URL;

	const {
		AccountConfigRepo,
		AccountExportRequestRepo,
		AccountRepo,
		AccountSettingRepo,
		AddressRepo,
		DrizzleEnvelopeRepository,
		DrizzleMessageFlagRepository,
		DrizzleMessageRepository,
		DrizzleThreadMessageRepository,
		DrizzleUnitOfWork,
		FilterAnchorRepo,
		FilterRepo,
		LabelRepo,
		MailboxLockRepo,
		MailboxRepo,
		MailboxSpecialUseRepo,
		MessageFlagPushRepo,
		messageDataSchema,
		MessageLabelRepo,
		MessagePlacementMoveRepo,
		OrganizeJobRequestRepo,
		OutboxMessageRepo,
	} = await import("@remit/drizzle-service");
	const { drizzle } = await import("drizzle-orm/node-postgres");

	// One drizzle db instance shared across repos.
	// The schema is registered for message-data tables; i4 repos use the same
	// underlying connection and only need the builder API (no relational queries).
	const db = drizzle(pgConnectionUrl, { schema: messageDataSchema });
	const genericDb = db as unknown as NodePgDatabase<Record<string, unknown>>;

	const accountService = new AccountRepo(genericDb);
	const accountConfigService = new AccountConfigRepo(genericDb);
	const accountSettingService = new AccountSettingRepo(genericDb);
	const addressService = new AddressRepo(genericDb);
	const mailboxService = new MailboxRepo(genericDb);
	const mailboxSpecialUseService = new MailboxSpecialUseRepo(genericDb);
	const mailboxLockService = new MailboxLockRepo(genericDb);
	const outboxMessageService = new OutboxMessageRepo(genericDb);
	const accountExportRequestService = new AccountExportRequestRepo(genericDb);
	const organizeJobRequestService = new OrganizeJobRequestRepo(genericDb);
	const placementMoveService = new MessagePlacementMoveRepo(genericDb);
	const flagPushMarkerService = new MessageFlagPushRepo(genericDb);
	const filterService = new FilterRepo(genericDb);
	const filterAnchorService = new FilterAnchorRepo(genericDb);
	const labelService = new LabelRepo(genericDb);
	const messageLabelService = new MessageLabelRepo(genericDb);

	const messageDataDb = db as unknown as NodePgDatabase<
		typeof messageDataSchema
	>;
	const envelopeService = new DrizzleEnvelopeRepository(messageDataDb);
	const messageService = new DrizzleMessageRepository(messageDataDb);
	const messageFlagService = new DrizzleMessageFlagRepository(messageDataDb);

	const threadMessageService = new DrizzleThreadMessageRepository(
		pgConnectionUrl,
	);

	const unitOfWork = new DrizzleUnitOfWork(messageDataDb);

	const sqsQueueUrl = env.SQS_QUEUE_URL;
	const sqsSmtpQueueUrl = process.env.SQS_QUEUE_URL_SMTP ?? sqsQueueUrl;

	const { storageService, searchService, secretsService } =
		buildSharedServices();

	const bodySyncService = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		addressService,
		envelopeService,
		logger,
	);

	const flagPushService = new FlagPushService({
		markerService: flagPushMarkerService,
		sqsQueueUrl,
		logger,
	});

	return {
		accountConfig: accountConfigService,
		account: accountService,
		accountSetting: accountSettingService,
		address: addressService,
		mailbox: mailboxService,
		mailboxSpecialUse: mailboxSpecialUseService,
		mailboxLock: mailboxLockService,
		message: messageService,
		messageFlag: messageFlagService,
		outboxMessage: outboxMessageService,
		threadMessage: threadMessageService,
		envelope: envelopeService,
		accountExportRequest: accountExportRequestService,
		organizeJobRequest: organizeJobRequestService,
		filter: filterService,
		filterAnchor: filterAnchorService,
		label: labelService,
		messageLabel: messageLabelService,
		unitOfWork,

		storage: storageService,
		search: searchService,
		secrets: secretsService,

		bodySync: bodySyncService,
		bodySyncQueue: buildBodySyncQueue(),
		placementMove: placementMoveService,
		flagPush: flagPushMarkerService,

		flagQueue: new FlagQueueService({
			messageFlagService,
			messageService,
			threadMessageService,
			flagPushService,
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

		createConnectionScope: buildConnectionScope(accountService, secretsService),
	};
};

export const getClient = (): Promise<RemitClient> => {
	if (!clientPromise) {
		clientPromise =
			process.env.DATA_BACKEND === "postgres"
				? buildPostgresClient()
				: Promise.resolve(buildDynamoDBClient());
	}

	return clientPromise;
};

/** Reset the singleton — test use only. */
export const _resetForTest = (): void => {
	clientPromise = null;
};

/** Inject a (usually partial) client — test use only. */
export const _setClientForTest = (override: RemitClient): void => {
	clientPromise = Promise.resolve(override);
};
