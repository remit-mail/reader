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
	/**
	 * References header from RFC 2822.
	 * Contains Message-IDs of ancestor messages, with the first being the thread root.
	 */
	references?: string[];
}

/**
 * Result of a mailbox sync operation
 */
export interface MailboxSyncResult {
	created: number;
	updated: number;
	deleted: number;
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
	listMailboxes(nsPrefix?: string): Promise<FlatMailboxInfo[]>;
	openBox(mailboxPath: string, readOnly?: boolean): Promise<ImapBoxStatus>;
	closeBox(expunge?: boolean): Promise<void>;
	search(criteria: unknown[]): Promise<number[]>;
	fetchMessages(uids: number[]): Promise<ImapMessage[]>;
	fetchMessageBody(uid: number): Promise<Buffer>;
}
