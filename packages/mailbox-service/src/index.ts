/**
 * remit-mailbox-service
 *
 * IMAP mailbox synchronization service for Remit
 */

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
	type FetchBodyResult,
	type SyncBodiesResult,
} from "./body-sync.js";
// Connection factory
export {
	createConnection,
	createConnectionFromAccount,
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
// IMAP connection (ImapFlow-based)
export {
	createImapFlowConnectionFromAccount,
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
	type MailboxSyncConfig,
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
	type SyncMessagesResult,
} from "./message-sync.js";
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
} from "./types.js";
