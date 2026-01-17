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
// Connection factory
export {
	createConnection,
	createConnectionFromAccount,
} from "./connection-factory.js";
// IMAP connection (ImapFlow-based)
export {
	createImapFlowConnectionFromAccount,
	ImapFlowConnection,
} from "./imapflow-connection.js";

export {
	type MailboxSyncConfig,
	MailboxSyncService,
	type SyncAccountInfo,
} from "./mailbox-sync.js";
export {
	type ImapConnectionFactory,
	MessageSyncService,
} from "./message-sync.js";
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
