/**
 * remit-mailbox-service
 *
 * IMAP mailbox synchronization service for Remit
 */

export {
	type AccountCredentialsDeps,
	encryptRefreshToken,
	resolveConnectionCredentials,
} from "./account-credentials.js";
export {
	hasChildren,
	isNoSelect,
	type ParsedAttributes,
	parseImapAttributes,
} from "./attribute-mapper.js";
export {
	BodyParseError,
	parseMessageBody,
} from "./body-parse.js";
export {
	type BodySyncLogger,
	BodySyncService,
	type ConnectionGetter,
	extractPrimaryFromEmail,
	type FetchBodyResult,
	type PlacementConfig,
	type QuarantineConfig,
	type SyncBodiesResult,
	toParsedBody,
} from "./body-sync.js";
export {
	type BodySyncQueueConfig,
	type BodySyncQueueLogger,
	BodySyncQueueService,
	type RequestBodySyncInput,
} from "./body-sync-queue.js";
export {
	isMessageBodySyncBroken,
	type ResolveExhaustedBodySyncDeps,
	type ResolveExhaustedBodySyncInput,
	type ResolveExhaustedBodySyncResult,
	resolveExhaustedBodySyncFailures,
} from "./body-sync-terminal.js";
// Connection factory
export {
	createConnection,
	createConnectionFromAccount,
	createConnectionWithCredentials,
	createManagedConnectionFactory,
	type ManagedConnectionFactory,
} from "./connection-factory.js";
// Connection testing
export {
	type ImapTestConfig,
	type SmtpTestConfig,
	type TestResult,
	testImapConnection,
	testSmtpConnection,
} from "./connection-test.js";
export { extractListId, normalizeListId } from "./filters/list-id.js";
export {
	buildMatchText,
	clauseMatches,
	cosineSimilarity,
	DEFAULT_SEMANTIC_MATCH_THRESHOLD,
	type FilterMessage,
	literalClausesMatch,
	NO_ACTION,
	selectMoveWinner,
} from "./filters/match.js";
export {
	type FilterConfig,
	type FilterDecision,
	type FilterLogger,
	FilterPipeline,
	type MessageEmbedder,
} from "./filters/pipeline.js";
export {
	type FlagPushConfig,
	type FlagPushEvent,
	type FlagPushLogger,
	type FlagPushOperationValue,
	FlagPushService,
} from "./flag-push.js";
export {
	type FlagPushTerminalOutcome,
	type ResolveExhaustedFlagPushDeps,
	type ResolveExhaustedFlagPushInput,
	type ResolveExhaustedFlagPushResult,
	resolveExhaustedFlagPushFailure,
} from "./flag-push-terminal.js";
export {
	type FlagQueueConfig,
	type FlagQueueLogger,
	FlagQueueService,
	type UpdateFlagsInput,
	type UpdateFlagsResult,
} from "./flag-queue.js";
export {
	classifyByHeaders,
	extractAuthenticity,
	extractAuthResult,
	extractHasListUnsubscribe,
	extractProviderSpam,
	type MessageAuthenticity,
	type MessageAuthResult,
	type MessageProviderSpam,
} from "./heuristics/classifyByHeaders.js";
export {
	classifyPlacement,
	type FolderPlacement,
	type PlacementAction,
	type PlacementVerdict,
} from "./heuristics/classifyPlacement.js";
export {
	classifyDisplayNameCorrespondence,
	extractOffDomainLinkDomains,
	extractSenderMismatch,
	type SenderMismatchContext,
	type SenderMismatchSignals,
} from "./heuristics/senderMismatch.js";
export { SOCIAL_DOMAINS } from "./heuristics/socialDomains.js";
export { TRANSACTIONAL_DOMAINS } from "./heuristics/transactionalDomains.js";
// IMAP connection (ImapFlow-based)
export {
	createImapFlowConnectionFromAccount,
	createImapFlowConnectionWithCredentials,
	ImapFlowConnection,
} from "./imapflow-connection.js";
export {
	backfillListIds,
	type ListIdBackfillCheckpoint,
	type ListIdBackfillCheckpointStore,
	type ListIdBackfillDeps,
	type ListIdBackfillLogger,
	type ListIdBackfillOptions,
	type ListIdBackfillProgress,
	type ListIdBackfillResult,
	type ListIdBackfillTotals,
} from "./list-id-backfill.js";
export {
	guardConnectionCursor,
	guardMailboxCursor,
	isCursorRebuildNeeded,
	type MailboxCursorCheck,
	type MailboxCursorGuardDeps,
	MailboxCursorPausedError,
} from "./mailbox-cursor.js";
export {
	type CursorRebuildMatch,
	type CursorRebuildMatchResult,
	type CursorRebuildRow,
	type CursorRebuildSnapshot,
	matchCursorRebuild,
} from "./mailbox-cursor-rebuild.js";
export {
	type CreateMailboxInput,
	type DeleteMailboxInput,
	type MailboxManagementLogger,
	MailboxManagementService,
	type MailboxManagementSyncResult,
	parseMailboxPath,
	type RenameMailboxInput,
	validateMailboxOperation,
	validateMailboxPath,
} from "./mailbox-management.js";
export {
	isFolderOffServer,
	isMailboxNotOnServer,
} from "./mailbox-presence.js";
export {
	type CreateMailboxQueueInput,
	type MailboxQueueConfig,
	type MailboxQueueLogger,
	MailboxQueueService,
} from "./mailbox-queue.js";
export {
	MailboxSyncService,
	type SyncAccountInfo,
} from "./mailbox-sync.js";
export {
	type DeleteOptions,
	type MessageMoveConfig,
	type MessageMoveLogger,
	MessageMoveService,
} from "./message-move.js";
export {
	type ParsedMessageContent,
	parseMessageContent,
} from "./message-parser.js";
export { isMessageGoneFromOpenMailbox } from "./message-presence.js";
export {
	type ImapConnectionFactory,
	MessageSyncService,
	type SyncedMessage,
	type SyncMessagesResult,
} from "./message-sync.js";
export {
	type CompleteOutboxAttachmentInput,
	type CompleteOutboxAttachmentOutcome,
	type MintOutboxAttachmentInput,
	type MintOutboxAttachmentOutcome,
	OUTBOX_ATTACHMENT_MAX_COUNT,
	OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
	type OutboxAttachmentConfig,
	type OutboxAttachmentRejectionDetail,
	type OutboxAttachmentRejectionReasonValue,
	type OutboxAttachmentReservation,
	OutboxAttachmentService,
} from "./outbox-attachment.js";
export {
	FALLBACK_CONTENT_TYPE,
	normalizeAttachmentContentType,
	sanitizeAttachmentFilename,
} from "./outbox-attachment-filename.js";
export {
	type CreateDraftInput,
	type OutboxQueueConfig,
	type OutboxQueueLogger,
	OutboxQueueService,
	type UpdateDraftInput,
} from "./outbox-queue.js";
export {
	type PlacementMoveConfig,
	type PlacementMoveLogger,
	type PlacementMovePushEvent,
	PlacementMoveService,
} from "./placement-move.js";
export {
	type PlacementMoveTerminalOutcome,
	type ResolveExhaustedPlacementMoveDeps,
	type ResolveExhaustedPlacementMoveInput,
	type ResolveExhaustedPlacementMoveResult,
	resolveExhaustedPlacementMoveFailure,
} from "./placement-move-terminal.js";
export { isPlacementUnsettled } from "./placement-settled.js";
export {
	type QuarantineContext,
	QuarantinedUids,
	type QuarantineFailure,
	type QuarantineLogger,
	type QuarantineMessageShape,
	QuarantineService,
	resolveMailboxRole,
	shapeFromMessageData,
} from "./quarantine.js";
export {
	extractSnippetFromEmail,
	generateSnippet,
	normalizeSubject,
	removeQuotedContent,
} from "./snippet.js";
export {
	MoveNotSettledError,
	type SpamReportConfig,
	type SpamReportLogger,
	type SpamReportParams,
	SpamReportService,
} from "./spam-report.js";
export {
	reconcileStaleMessage,
	type StaleMessageReconcileDeps,
	type StaleMessageReconcileResult,
} from "./stale-message-reconcile.js";
export type {
	FlatMailboxInfo,
	IImapConnection,
	ImapBoxStatus,
	ImapConnectionConfig,
	ImapConnectionState,
	ImapNamespace,
	ImapNamespaces,
	MailboxSyncResult,
	MailConnectionErrorKind,
	MailCredentials,
} from "./types.js";
export { MailConnectionError } from "./types.js";
