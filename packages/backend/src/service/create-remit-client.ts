import type {
	IAccountConfigRepository,
	IAccountExportRequestRepository,
	IAccountRepository,
	IAccountSettingRepository,
	IAddressRepository,
	IConfigImportRepository,
	IEnvelopeRepository,
	IFilterAnchorRepository,
	IFilterAnchorTransaction,
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
	IOutboxAttachmentRepository,
	IOutboxMessageRepository,
	IQuarantineRepository,
	ISenderSignerStandingRepository,
	IThreadMessageRepository,
	IUnitOfWork,
} from "@remit/data-ports";
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
	OutboxAttachmentService,
	OutboxQueueService,
	PlacementMoveService,
	SpamReportService,
} from "@remit/mailbox-service";
import { createSearchService, type SearchService } from "@remit/search-service";
import {
	buildEmbeddingServiceFromEnv,
	buildVectorStoreFromEnv,
} from "@remit/search-service/from-env";
import {
	createCachedDataKeyProvider,
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
	FAKE_KMS_KEY_ID,
	type SecretsService,
} from "@remit/secrets-service";
import type { StorageService } from "@remit/storage-service";
import { createStorageService } from "@remit/storage-service/s3";
import { env } from "expect-env";

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

	// Applied configuration imports (#1021), and the folder references each is
	// still waiting for. Read by GET /config to surface what a file named but
	// IMAP has not produced yet, and written by the binder when it does.
	configImport: IConfigImportRepository;

	// Messages the sync path could not read (issue #72). Read-only from the API
	// process: the sync worker writes the rows, settings lists them.
	quarantine: IQuarantineRepository;

	// Smart Organize back-apply job (RFC 034, #1278). Present on both backends,
	// modeled on accountExportRequest — a Pending row the account-fanout worker
	// picks up and drives to Complete/Failed. Never a Filter.
	organizeJobRequest: IOrganizeJobRequestRepository;

	// Smart Organize (RFC 034, epic #1280). Present on both backends
	// (`FilterService`/`LabelService`/… on DynamoDB, `FilterRepo`/`LabelRepo`/…
	// relationally) so the matching pipeline and filter CRUD run unchanged on
	// either. The relational side has no TTL reaper for expired Temporary filters;
	// match-time correctness gates on `expiresAt` (RFC 034 Decision 1.1), never
	// on the row still existing, so the missing reaper is housekeeping only.
	filter: IFilterRepository;
	filterAnchor: IFilterAnchorRepository;

	// Atomically creates a Filter and its optional sibling FilterAnchor row in
	// one transaction (#351) — a failed anchor write can never leave a Filter
	// durably marked hasAnchor: true with no matching FilterAnchor row.
	filterAnchorTransaction: IFilterAnchorTransaction;
	label: ILabelRepository;
	messageLabel: IMessageLabelRepository;

	// How often a sender has been seen arriving under one DKIM signing identity,
	// per account. Read by the authenticity derivation to tell a familiar
	// third-party signer from a first sighting; written once per message by
	// body-sync, which is its only writer.
	senderSignerStanding: ISenderSignerStandingRepository;

	// Atomic write set for a message save. Present on the relational backend (real
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
	// relationally) so a caller never needs to guess which backend is active. Used
	// for read-time count prediction (epic #1281 invariant 4) and by the
	// account-worker cascade delete. Written by the imap-worker's bulk
	// body-sync path through this `placementMove`, so the placement producer
	// runs on whatever backend is active — DynamoDB or SQLite.
	placementMove: IMessagePlacementMoveRepository;

	// Pending flag-push markers (issue #1273). Present on both backends
	// (`MessageFlagPushService` on DynamoDB, `MessageFlagPushRepo` on
	// relationally). Used for read-time unseenCount prediction (epic #1281
	// invariant 4), by the account-worker cascade delete, and by the periodic
	// per-mailbox sync tick to re-arm a marker stuck `pending`. Unlike
	// `placementMove`, this one IS written on both backends — `flagQueue`
	// below writes through it regardless of `DATA_BACKEND`.
	flagPush: IMessageFlagPushRepository;

	// Queue services (writes with IMAP sync)
	flagQueue: FlagQueueService;
	mailboxQueue: MailboxQueueService;
	messageMove: MessageMoveService;
	outboxAttachment: OutboxAttachmentService;
	outboxQueue: OutboxQueueService;

	// Report-spam / not-spam (block-and-move, unified from the old separate
	// Block + Mark spam actions). Composed over `messageMove` and the same
	// `flagPushService` instance `flagQueue` shares below.
	spamReport: SpamReportService;

	// Helper to create IMAP connection scope from accountId
	createConnectionScope: (accountId: string) => Promise<ConnectionScope>;

	// Runs an arbitrary set of repository writes as one transaction. Absent on a
	// backend with no cross-entity transaction, where the caller's contract is
	// instead: validate before the first write, fail fast, and report what
	// landed. The message-save write set has its own bound repositories and uses
	// `unitOfWork`; this one takes the repos as they are.
	writeSet?: <T>(run: () => Promise<T>) => Promise<T>;
}

export interface RemitClientRepositories {
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
	outboxAttachment: IOutboxAttachmentRepository;
	threadMessage: IThreadMessageRepository;
	envelope: IEnvelopeRepository;
	accountExportRequest: IAccountExportRequestRepository;
	configImport: IConfigImportRepository;
	quarantine: IQuarantineRepository;
	organizeJobRequest: IOrganizeJobRequestRepository;
	placementMove: IMessagePlacementMoveRepository;
	flagPush: IMessageFlagPushRepository;
	filter: IFilterRepository;
	filterAnchor: IFilterAnchorRepository;
	filterAnchorTransaction: IFilterAnchorTransaction;
	label: ILabelRepository;
	messageLabel: IMessageLabelRepository;
	senderSignerStanding: ISenderSignerStandingRepository;
	unitOfWork?: IUnitOfWork;
	writeSet?: <T>(run: () => Promise<T>) => Promise<T>;
}

export interface RemitClientSharedDeps {
	storage: StorageService;
	search: SearchService;
	secrets: SecretsService;
	sqsQueueUrl: string;
	sqsSmtpQueueUrl: string;
	bodySyncQueue?: BodySyncQueueService;
}

export interface RemitClientDeps extends RemitClientSharedDeps {
	repositories: RemitClientRepositories;
}

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

// The body queue lives on the worker infra; the API only knows it locally
// (dev / e2e set SQS_QUEUE_URL_BODY). When unset the read path still returns a
// retryable 202 — it just cannot re-arm the cue itself.
const buildBodySyncQueue = (): BodySyncQueueService | undefined => {
	const bodyQueueUrl = process.env.SQS_QUEUE_URL_BODY;
	if (!bodyQueueUrl) return undefined;
	return new BodySyncQueueService({ sqsQueueUrl: bodyQueueUrl, logger });
};

// Everything a RemitClient needs that is chosen from the environment and does
// not vary by data backend: storage, search, secrets, the SQS queue URLs, and
// the optional body-sync queue. Each composition root builds its backend's
// repositories and merges them with this.
export const buildSharedDeps = (): RemitClientSharedDeps => {
	const storage = createStorageService();
	const search = buildSearchService();
	const kmsKeyId = process.env.KMS_KEY_ID ?? FAKE_KMS_KEY_ID;
	const dataKeyProvider = createCachedDataKeyProvider(
		createKmsDataKeyProvider(kmsKeyId),
	);
	const secrets = createSecretsService(dataKeyProvider);
	const sqsQueueUrl = env.SQS_QUEUE_URL;
	const sqsSmtpQueueUrl = process.env.SQS_QUEUE_URL_SMTP ?? sqsQueueUrl;
	return {
		storage,
		search,
		secrets,
		sqsQueueUrl,
		sqsSmtpQueueUrl,
		bodySyncQueue: buildBodySyncQueue(),
	};
};

// Backend-neutral composition root: given repositories (from any data-ports
// implementation) and the shared services, wire the domain and queue services
// and assemble a RemitClient. Imports neither ElectroDB nor Drizzle — the
// caller chooses the backend.
export const createRemitClient = (deps: RemitClientDeps): RemitClient => {
	const {
		repositories,
		storage,
		search,
		secrets,
		sqsQueueUrl,
		sqsSmtpQueueUrl,
		bodySyncQueue,
	} = deps;

	// The read-path body backfill (describeMessage / getRawMessage →
	// fetchAndGetBody) materializes a body that was never sync-synced, and must
	// run the account's standing filters the same way the imap-worker's sync path
	// does. Without this, a message a user opens before background body-sync is
	// classified but never filter-evaluated — and once its body is stored the
	// filter-capable sync path skips it, so an explicit standing filter silently
	// never fires (issue #223). Only the explicit user-rule half is wired here;
	// heuristic classifier placement stays on the sync path. Wired like
	// `sync-message-body.ts`, over the message-management queue's local-first
	// PlacementMoveService; filters stay off when that queue is unset.
	const placementMoveQueueUrl = process.env.SQS_QUEUE_URL_MESSAGE_MGMT;
	const placementMoveService = placementMoveQueueUrl
		? new PlacementMoveService({
				messageService: repositories.message,
				threadMessageService: repositories.threadMessage,
				markerService: repositories.placementMove,
				addressService: repositories.address,
				mailboxSpecialUseService: repositories.mailboxSpecialUse,
				sqsQueueUrl: placementMoveQueueUrl,
			})
		: undefined;
	const filterConfig = placementMoveService
		? {
				filterService: repositories.filter,
				filterAnchorService: repositories.filterAnchor,
				messageLabelService: repositories.messageLabel,
				placementMoveService,
			}
		: undefined;

	const flagPushService = new FlagPushService({
		markerService: repositories.flagPush,
		sqsQueueUrl,
		logger,
	});

	// Shared with the returned `flagQueue` below (issue #302): body sync
	// auto-marks-read a message from an unsubscribed sender through the exact
	// same `FlagQueueService.markAsRead` a manual mark-as-read goes through, not
	// a second instance or a second primitive.
	const flagQueueService = new FlagQueueService({
		messageFlagService: repositories.messageFlag,
		messageService: repositories.message,
		threadMessageService: repositories.threadMessage,
		flagPushService,
		logger,
	});

	const messageMoveService = new MessageMoveService({
		messageService: repositories.message,
		mailboxService: repositories.mailbox,
		mailboxSpecialUseService: repositories.mailboxSpecialUse,
		threadMessageService: repositories.threadMessage,
		addressService: repositories.address,
		sqsQueueUrl,
		logger,
	});

	// One instance, shared with the queue service below: the per-draft chain that
	// makes the attachment cap safe under concurrency lives on it, and a discard
	// racing an upload has to take the same lock the upload does.
	const outboxAttachmentService = new OutboxAttachmentService({
		outboxMessageService: repositories.outboxMessage,
		outboxAttachmentService: repositories.outboxAttachment,
		storage,
	});

	const bodySync = new BodySyncService(
		repositories.message,
		storage,
		repositories.threadMessage,
		repositories.address,
		repositories.envelope,
		logger,
		undefined,
		filterConfig,
		undefined,
		{ flagQueueService },
	);

	return {
		accountConfig: repositories.accountConfig,
		account: repositories.account,
		accountSetting: repositories.accountSetting,
		address: repositories.address,
		mailbox: repositories.mailbox,
		mailboxSpecialUse: repositories.mailboxSpecialUse,
		mailboxLock: repositories.mailboxLock,
		message: repositories.message,
		messageFlag: repositories.messageFlag,
		outboxMessage: repositories.outboxMessage,
		threadMessage: repositories.threadMessage,
		envelope: repositories.envelope,
		accountExportRequest: repositories.accountExportRequest,
		configImport: repositories.configImport,
		quarantine: repositories.quarantine,
		organizeJobRequest: repositories.organizeJobRequest,
		filter: repositories.filter,
		filterAnchor: repositories.filterAnchor,
		filterAnchorTransaction: repositories.filterAnchorTransaction,
		label: repositories.label,
		messageLabel: repositories.messageLabel,
		senderSignerStanding: repositories.senderSignerStanding,
		unitOfWork: repositories.unitOfWork,
		writeSet: repositories.writeSet,

		storage,
		search,
		secrets,

		bodySync,
		bodySyncQueue,
		placementMove: repositories.placementMove,
		flagPush: repositories.flagPush,

		flagQueue: flagQueueService,
		mailboxQueue: new MailboxQueueService({
			mailboxService: repositories.mailbox,
			sqsQueueUrl,
			logger,
		}),
		messageMove: messageMoveService,
		outboxAttachment: outboxAttachmentService,
		outboxQueue: new OutboxQueueService({
			outboxMessageService: repositories.outboxMessage,
			outboxAttachmentService,
			accountService: repositories.account,
			sqsSmtpQueueUrl,
			logger,
		}),
		spamReport: new SpamReportService({
			messageService: repositories.message,
			addressService: repositories.address,
			accountService: repositories.account,
			mailboxSpecialUseService: repositories.mailboxSpecialUse,
			messageMoveService,
			flagPushService,
			logger,
		}),

		createConnectionScope: buildConnectionScope(repositories.account, secrets),
	};
};
