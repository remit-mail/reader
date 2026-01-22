/**
 * Types for the remit-mailbox-service
 */

/**
 * IMAP connection configuration
 */
export interface ImapConnectionConfig {
	host: string;
	port: number;
	user: string;
	password: string;
	tls: boolean;
	tlsOptions?: {
		rejectUnauthorized?: boolean;
		servername?: string;
	};
	/** Connection timeout in milliseconds */
	connTimeout?: number;
	/** Authentication timeout in milliseconds */
	authTimeout?: number;
}

/**
 * IMAP connection state
 */
export type ImapConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "authenticated"
	| "error";

/**
 * Mailbox structure as returned by node-imap getBoxes()
 */
export interface ImapMailbox {
	attribs: string[];
	delimiter: string;
	children: Record<string, ImapMailbox> | null;
	parent: ImapMailbox | null;
}

/**
 * Namespace structure from IMAP NAMESPACE command
 */
export interface ImapNamespace {
	prefix: string;
	delimiter: string | false;
	extensions?: Array<{
		name: string;
		params: string[] | null;
	}>;
}

/**
 * IMAP namespaces grouped by type
 */
export interface ImapNamespaces {
	personal: ImapNamespace[];
	other: ImapNamespace[];
	shared: ImapNamespace[];
}

/**
 * IMAP mailbox status after opening
 */
export interface ImapBoxStatus {
	name: string;
	readOnly: boolean;
	uidvalidity: number;
	uidnext: number;
	flags: string[];
	permFlags: string[];
	persistentUIDs: boolean;
	messages: {
		total: number;
		new: number;
	};
	newKeywords: boolean;
}

/**
 * Flattened mailbox info for processing
 */
export interface FlatMailboxInfo {
	fullPath: string;
	name: string;
	delimiter: string;
	attributes: string[];
	parentPath: string | null;
}

export interface ImapAddress {
	name?: string;
	mailbox: string;
	host: string;
}

export interface ImapEnvelope {
	date: string;
	subject: string;
	from: ImapAddress[];
	sender: ImapAddress[];
	replyTo: ImapAddress[];
	to: ImapAddress[];
	cc: ImapAddress[];
	bcc: ImapAddress[];
	inReplyTo: string;
	messageId: string;
}

export interface ImapMessage {
	uid: number;
	seq: number;
	flags: string[];
	internalDate: Date;
	size: number;
	envelope?: ImapEnvelope;
}

/**
 * Result of a mailbox sync operation
 */
export interface MailboxSyncResult {
	created: number;
	updated: number;
	deleted: number;
	errors: Array<{
		mailboxPath: string;
		error: string;
	}>;
}

/**
 * Common interface for IMAP connections
 */
export interface IImapConnection {
	readonly state: ImapConnectionState;
	readonly isConnected: boolean;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	getNamespaces(): Promise<ImapNamespaces>;
	getBoxes(nsPrefix?: string): Promise<Record<string, ImapMailbox>>;
	openBox(mailboxPath: string, readOnly?: boolean): Promise<ImapBoxStatus>;
	closeBox(expunge?: boolean): Promise<void>;
	flattenBoxes(
		boxes: Record<string, ImapMailbox>,
		parentPath?: string,
	): FlatMailboxInfo[];
	search(criteria: unknown[]): Promise<number[]>;
	fetchMessages(uids: number[]): Promise<ImapMessage[]>;
}
