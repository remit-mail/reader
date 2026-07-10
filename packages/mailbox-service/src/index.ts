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
	type BodySyncLogger,
	BodySyncService,
	type ConnectionGetter,
	extractPrimaryFromEmail,
	type FetchBodyResult,
	type PlacementConfig,
	type SyncBodiesResult,
	toParsedBody,
} from "./body-sync.js";
export {
	type BodySyncQueueConfig,
	type BodySyncQueueLogger,
	BodySyncQueueService,
	type RequestBodySyncInput,
} from "./body-sync-queue.js";
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
export {
	type FlagQueueConfig,
	type FlagQueueLogger,
	FlagQueueService,
	type UpdateFlagsInput,
	type UpdateFlagsResult,
} from "./flag-queue.js";
export {
	type FlagOperation,
	type FlagSyncLogger,
	type FlagSyncResult,
	FlagSyncService,
} from "./flag-sync.js";
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
export { SOCIAL_DOMAINS } from "./heuristics/socialDomains.js";
export { TRANSACTIONAL_DOMAINS } from "./heuristics/transactionalDomains.js";
// IMAP connection (ImapFlow-based)
export {
	createImapFlowConnectionFromAccount,
	createImapFlowConnectionWithCredentials,
	ImapFlowConnection,
} from "./imapflow-connection.js";
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
export {
	type ImapConnectionFactory,
	MessageSyncService,
	type SyncedMessage,
	type SyncMessagesResult,
} from "./message-sync.js";
export {
	type CreateDraftInput,
	type OutboxQueueConfig,
	type OutboxQueueLogger,
	OutboxQueueService,
	type UpdateDraftInput,
} from "./outbox-queue.js";
export {
	extractSnippetFromEmail,
	generateSnippet,
	normalizeSubject,
	removeQuotedContent,
} from "./snippet.js";
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
