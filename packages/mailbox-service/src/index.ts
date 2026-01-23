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
	createImapConnectionFromAccount,
	ImapConnection,
} from "./imap-connection.js";
export {
	type MailboxSyncConfig,
	MailboxSyncService,
	type SyncAccountInfo,
} from "./mailbox-sync.js";
export type {
	FlatMailboxInfo,
	ImapBoxStatus,
	ImapConnectionConfig,
	ImapConnectionState,
	ImapMailbox,
	ImapNamespace,
	ImapNamespaces,
	MailboxSyncResult,
} from "./types.js";
