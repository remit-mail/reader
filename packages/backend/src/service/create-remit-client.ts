import type {
	IAccountConfigRepository,
	IAccountExportRequestRepository,
	IAccountRepository,
	IAccountSettingRepository,
	IAddressRepository,
	ICalendarCollectionRepository,
	ICalendarEventIndexRepository,
	ICalendarFeedTokenRepository,
	ICalendarObjectRepository,
	ICalendarStore,
	ICalendarSuggestionRepository,
	IConfigImportRepository,
	IEnvelopeRepository,
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
	ISyncWarningRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import { logger } from "@remit/logger";
import {
	BodySyncQueueService,
	BodySyncService,
	type ConnectionScope,
	connectionScope,
	type FilterConfig,
	FlagPushService,
	FlagQueueService,
	fifoMailboxManagement,
	type ImapTransport,
	MailboxQueueService,
	MessageMoveService,
	OutboxAttachmentService,
	OutboxQueueService,
	PlacementMoveService,
	SpamReportService,
	SyncWarningService,
} from "@remit/mailbox-service";
import { buildFilterConfig } from "@remit/mailbox-service/filter-config";
import {
	deserializeEncryptedPayload,
	type SecretsService,
} from "@remit/secrets-service";
import type { StorageService } from "@remit/storage-service";
import type { QueueName, RemitClientQueues } from "./queues.js";

export type { ConnectionScope };

export type ConnectionScopeFactory = (
	accountService: IAccountRepository,
	secretsService: SecretsService,
) => (accountId: string) => Promise<ConnectionScope>;

export interface RemitClientCore {
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

	syncWarning: ISyncWarningRepository;

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
	label: ILabelRepository;
	messageLabel: IMessageLabelRepository;

	// How often a sender has been seen arriving under one DKIM signing identity,
	// per account. Read by the authenticity derivation to tell a familiar
	// third-party signer from a first sighting; written once per message by
	// body-sync, which is its only writer.
	senderSignerStanding: ISenderSignerStandingRepository;

	// The calendar store (issue #15) and the cards a message offers into it
	// (issue #1033). Every write goes through `calendarStore`: the object,
	// its occurrence rows, the collection's sequence bump and — when the write
	// came from accepting a suggestion — that suggestion's own state are one
	// fact, and the repositories beside it are the read side. A backend that
	// cannot supply them cannot serve the calendar at all, so they are part of
	// the client rather than something each handler checks for.
	calendarCollection: ICalendarCollectionRepository;
	calendarObject: ICalendarObjectRepository;
	calendarEventIndex: ICalendarEventIndexRepository;
	calendarFeedToken: ICalendarFeedTokenRepository;
	calendarSuggestion: ICalendarSuggestionRepository;
	calendarStore: ICalendarStore;

	// Storage service
	storage: StorageService;

	// Secrets service (KMS encryption)
	secrets: SecretsService;

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

	outboxAttachment: OutboxAttachmentService;

	// Helper to create IMAP connection scope from accountId
	createConnectionScope: (accountId: string) => Promise<ConnectionScope>;
}

export interface SyncQueueServices {
	flagQueue: FlagQueueService;
	mailboxQueue: MailboxQueueService;
	messageMove: MessageMoveService;
	// Report-spam / not-spam (block-and-move, unified from the old separate
	// Block + Mark spam actions). Composed over `messageMove` and the same
	// `FlagPushService` instance `flagQueue` writes through.
	spamReport: SpamReportService;
}

export interface SmtpQueueServices {
	outboxQueue: OutboxQueueService;
}

export interface BodyQueueServices {
	// Re-arms the SYNC_MESSAGE_BODY cue when a read-path body fetch finds the
	// storage object missing.
	bodySyncQueue: BodySyncQueueService;
}

export interface ReadPathServices {
	bodySync: BodySyncService;
}

export type RemitClient<K extends QueueName = QueueName> = RemitClientCore & {
	queues: Pick<RemitClientQueues, K>;
} & ("sync" extends K ? SyncQueueServices : unknown) &
	("smtp" extends K ? SmtpQueueServices : unknown) &
	("body" extends K ? BodyQueueServices : unknown) &
	("sync" | "messageManagement" extends K ? ReadPathServices : unknown);

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
	syncWarning: ISyncWarningRepository;
	organizeJobRequest: IOrganizeJobRequestRepository;
	placementMove: IMessagePlacementMoveRepository;
	flagPush: IMessageFlagPushRepository;
	filter: IFilterRepository;
	label: ILabelRepository;
	messageLabel: IMessageLabelRepository;
	senderSignerStanding: ISenderSignerStandingRepository;
	calendarCollection: ICalendarCollectionRepository;
	calendarObject: ICalendarObjectRepository;
	calendarEventIndex: ICalendarEventIndexRepository;
	calendarFeedToken: ICalendarFeedTokenRepository;
	calendarSuggestion: ICalendarSuggestionRepository;
	calendarStore: ICalendarStore;
}

export interface RemitClientSharedDeps {
	storage: StorageService;
	secrets: SecretsService;
	connectionScope: ConnectionScopeFactory;
	queues: RemitClientQueues;
}

export interface RemitClientDeps extends RemitClientSharedDeps {
	repositories: RemitClientRepositories;
}

export const passwordConnectionScope =
	(transport: ImapTransport): ConnectionScopeFactory =>
	(accountService, secretsService) =>
	async (accountId) => {
		const account = await accountService.get(accountId);
		if (!account.passwordHash) {
			throw new Error(
				`Account ${accountId} has no passwordHash — OAuth accounts cannot use this connection path`,
			);
		}
		const password = await secretsService.decrypt(
			deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
		);

		return connectionScope({
			user: account.username,
			credentials: { kind: "password", password },
			host: account.imapHost,
			port: account.imapPort,
			tls: account.imapTls,
			transport,
		});
	};

// The read-path body backfill (describeMessage / getRawMessage →
// fetchAndGetBody) materializes a body that was never sync-synced, and must run
// the account's standing filters the same way the imap-worker's sync path does.
// Without this, a message a user opens before background body-sync is classified
// but never filter-evaluated — and once its body is stored the filter-capable
// sync path skips it, so an explicit standing filter silently never fires (issue
// #223). Only the explicit user-rule half is wired here; heuristic classifier
// placement stays on the sync path. It shares `buildFilterConfig` with
// `sync-message-body.ts`, so a filter fires on either (issue #298). Over the
// message-management queue's local-first PlacementMoveService.
export const buildReadPathFilterConfig = (
	repositories: Pick<
		RemitClientRepositories,
		| "filter"
		| "messageLabel"
		| "mailbox"
		| "message"
		| "threadMessage"
		| "placementMove"
		| "address"
		| "mailboxSpecialUse"
	>,
	queues: Pick<RemitClientQueues, "messageManagement">,
): FilterConfig => {
	const { messageManagement } = queues;
	return buildFilterConfig({
		filterService: repositories.filter,
		messageLabelService: repositories.messageLabel,
		mailboxService: repositories.mailbox,
		placementMoveService: new PlacementMoveService({
			messageService: repositories.message,
			threadMessageService: repositories.threadMessage,
			markerService: repositories.placementMove,
			addressService: repositories.address,
			mailboxSpecialUseService: repositories.mailboxSpecialUse,
			mailboxService: repositories.mailbox,
			queue: messageManagement,
		}),
	});
};

export const createRemitCore = (
	deps: Omit<RemitClientDeps, "queues">,
): RemitClientCore => {
	const { repositories, storage, secrets, connectionScope } = deps;
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
		syncWarning: repositories.syncWarning,
		organizeJobRequest: repositories.organizeJobRequest,
		filter: repositories.filter,
		label: repositories.label,
		messageLabel: repositories.messageLabel,
		senderSignerStanding: repositories.senderSignerStanding,
		calendarCollection: repositories.calendarCollection,
		calendarObject: repositories.calendarObject,
		calendarEventIndex: repositories.calendarEventIndex,
		calendarFeedToken: repositories.calendarFeedToken,
		calendarSuggestion: repositories.calendarSuggestion,
		calendarStore: repositories.calendarStore,
		storage,
		secrets,
		placementMove: repositories.placementMove,
		flagPush: repositories.flagPush,
		// One instance, shared with the outbox queue service: the per-draft chain
		// that makes the attachment cap safe under concurrency lives on it, and a
		// discard racing an upload has to take the same lock the upload does.
		outboxAttachment: new OutboxAttachmentService({
			outboxMessageService: repositories.outboxMessage,
			outboxAttachmentService: repositories.outboxAttachment,
			storage,
		}),
		createConnectionScope: connectionScope(repositories.account, secrets),
	};
};

export const composeSyncServices = (
	core: RemitClientCore,
	queues: Pick<RemitClientQueues, "sync">,
): SyncQueueServices => {
	const flagPushService = new FlagPushService({
		markerService: core.flagPush,
		queue: queues.sync,
		logger,
	});
	const messageMove = new MessageMoveService({
		messageService: core.message,
		mailboxService: core.mailbox,
		mailboxSpecialUseService: core.mailboxSpecialUse,
		threadMessageService: core.threadMessage,
		addressService: core.address,
		queue: queues.sync,
		logger,
	});
	return {
		flagQueue: new FlagQueueService({
			messageFlagService: core.messageFlag,
			messageService: core.message,
			threadMessageService: core.threadMessage,
			flagPushService,
			logger,
		}),
		mailboxQueue: new MailboxQueueService({
			mailboxService: core.mailbox,
			enqueue: fifoMailboxManagement(queues.sync),
			logger,
		}),
		messageMove,
		spamReport: new SpamReportService({
			messageService: core.message,
			addressService: core.address,
			accountService: core.account,
			mailboxSpecialUseService: core.mailboxSpecialUse,
			messageMoveService: messageMove,
			flagPushService,
			logger,
		}),
	};
};

export const composeSmtpServices = (
	core: RemitClientCore,
	queues: Pick<RemitClientQueues, "smtp">,
): SmtpQueueServices => ({
	outboxQueue: new OutboxQueueService({
		outboxMessageService: core.outboxMessage,
		outboxAttachmentService: core.outboxAttachment,
		accountService: core.account,
		queue: queues.smtp,
		logger,
	}),
});

export const composeBodyServices = (
	queues: Pick<RemitClientQueues, "body">,
): BodyQueueServices => ({
	bodySyncQueue: new BodySyncQueueService({ queue: queues.body, logger }),
});

export const composeReadPathServices = (
	core: RemitClientCore,
	queues: Pick<RemitClientQueues, "messageManagement">,
	sync: Pick<SyncQueueServices, "flagQueue">,
): ReadPathServices => ({
	// The flag service is the one `flagQueue` is (issue #302): body sync
	// auto-marks-read a message from an unsubscribed sender through the exact
	// same `FlagQueueService.markAsRead` a manual mark-as-read goes through.
	bodySync: new BodySyncService(
		core.message,
		core.storage,
		core.threadMessage,
		core.address,
		core.envelope,
		new SyncWarningService(core.syncWarning),
		logger,
		undefined,
		buildReadPathFilterConfig(core, queues),
		undefined,
		{ flagQueueService: sync.flagQueue },
		// The read-path backfill materializes a body the sync path never got to,
		// so it is a message's first sight as much as the sync pass is — and an
		// invitation the user opens before background sync must still get its
		// card (issue #1033, the same argument as the filter wiring above).
		{
			calendarSuggestionService: core.calendarSuggestion,
			calendarStore: core.calendarStore,
			filterService: core.filter,
		},
	),
});

export const createRemitClient = (deps: RemitClientDeps): RemitClient => {
	const { queues } = deps;
	const core = createRemitCore(deps);
	const sync = composeSyncServices(core, queues);
	return {
		...core,
		queues,
		...sync,
		...composeSmtpServices(core, queues),
		...composeBodyServices(queues),
		...composeReadPathServices(core, queues, sync),
	};
};
