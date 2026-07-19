/**
 * Types for the remit-mailbox-service
 */

import type { Readable } from "node:stream";

/**
 * Discriminated union of mail authentication credentials.
 *
 * Exactly one credential kind can be present at a time — the union makes
 * "both password and accessToken simultaneously" unrepresentable.
 */
export type MailCredentials =
	| { kind: "password"; password: string }
	| { kind: "accessToken"; accessToken: string };

/**
 * Classification of mail connection errors.
 */
export type MailConnectionErrorKind = "auth" | "network";

/**
 * Typed error for IMAP/SMTP connection failures.
 *
 * `kind: "auth"` — authentication rejected (bad credentials / token expired).
 * `kind: "network"` — transport-level failure (ECONNREFUSED, ETIMEDOUT, etc.).
 *
 * IMPORTANT: access tokens must NEVER appear in error messages or causes.
 */
export class MailConnectionError extends Error {
	readonly kind: MailConnectionErrorKind;

	constructor(kind: MailConnectionErrorKind, message: string, cause?: unknown) {
		super(message, { cause });
		this.name = "MailConnectionError";
		this.kind = kind;
	}
}

/**
 * IMAP connection configuration
 */
export interface ImapConnectionConfig {
	host: string;
	port: number;
	user: string;
	credentials: MailCredentials;
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
 * IMAP mailbox status from STATUS command
 */
export interface ImapMailboxStatus {
	messages: number;
	recent: number;
	unseen: number;
	uidNext: number;
	uidValidity: number;
	/** Highest modification sequence (CONDSTORE) as decimal digits of an unsigned 64-bit value. "0" if the server does not support CONDSTORE. */
	highestModseq: string;
	/** Count of messages flagged \Deleted but not yet expunged. */
	deletedCount: number;
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

/**
 * Subset of imapflow's `MessageStructureObject` we depend on. Restated
 * here so non-imapflow code (and tests) can build fixtures without pulling
 * the imapflow types in.
 */
export interface ImapBodyStructure {
	/** Dot-numbered MIME path; absent on the root node. */
	part?: string;
	/** Full Content-Type, e.g. "text/plain" or "multipart/mixed". */
	type: string;
	parameters?: Record<string, string>;
	id?: string;
	description?: string;
	encoding?: string;
	size?: number;
	lineCount?: number;
	md5?: string;
	disposition?: string;
	dispositionParameters?: Record<string, string>;
	language?: string[];
	location?: string;
	childNodes?: ImapBodyStructure[];
}

/**
 * One server message from the cheap envelope-only FETCH the UIDVALIDITY
 * cursor rebuild uses (#1272): UID + Message-ID + INTERNALDATE, nothing
 * else — no flags, no BODYSTRUCTURE, no body fetch.
 */
export interface ImapEnvelopeSnapshot {
	uid: number;
	/** Raw RFC 822 Message-ID header; empty string when absent/unparseable. */
	messageId: string;
	internalDate: Date;
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
	/** Parsed BODYSTRUCTURE tree (RFC 9051 Section 7.5.2). */
	bodyStructure?: ImapBodyStructure;
	/**
	 * Per-message MODSEQ (RFC 7162) as decimal digits of an unsigned 64-bit
	 * value. Absent when the session has no CONDSTORE.
	 */
	modseq?: string;
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
	/**
	 * True when the session negotiated CONDSTORE (RFC 7162) AND the currently
	 * open mailbox keeps persistent mod-sequences. A mailbox that answered
	 * NOMODSEQ on SELECT reports false, as does any server that never
	 * advertised the extension. Requires a mailbox to be open.
	 */
	supportsCondstore(): boolean;
	/**
	 * FETCH every message in the open mailbox whose MODSEQ is strictly greater
	 * than `sinceModseq` (RFC 7162 CHANGEDSINCE) — both messages that arrived
	 * and messages whose metadata changed. Requires a mailbox to be open.
	 *
	 * Throws when CONDSTORE is unavailable: the underlying client drops the
	 * modifier in that case, which would silently turn the call into a fetch of
	 * the entire mailbox.
	 */
	fetchMessagesChangedSince(sinceModseq: bigint): Promise<ImapMessage[]>;
	/**
	 * Cheap envelope-only pass for the UIDVALIDITY cursor rebuild (#1272): UID
	 * + Message-ID + INTERNALDATE for every UID, no BODYSTRUCTURE, no flags,
	 * no body. Requires a mailbox to be open.
	 */
	fetchEnvelopeSnapshots(uids: number[]): Promise<ImapEnvelopeSnapshot[]>;
	fetchMessageBody(uid: number): Promise<Buffer>;
	/**
	 * Fetch full message bodies for many UIDs in ONE pipelined ranged UID FETCH.
	 * Yields `{ uid, source }` per message; `source` is a readable stream the
	 * caller must consume before requesting the next item. Requires a mailbox to
	 * be open (one SELECT for the whole batch).
	 */
	fetchMessageBodies(
		uids: number[],
	): AsyncGenerator<{ uid: number; source: Readable }>;
	/**
	 * Add flags to messages by UID.
	 * Requires mailbox to be open.
	 */
	addFlags(uids: number[], flags: string[]): Promise<void>;
	/**
	 * Remove flags from messages by UID.
	 * Requires mailbox to be open.
	 */
	removeFlags(uids: number[], flags: string[]): Promise<void>;
	/**
	 * Replace all flags on messages by UID.
	 * Requires mailbox to be open.
	 */
	setFlags(uids: number[], flags: string[]): Promise<void>;
	/**
	 * Create a new mailbox.
	 */
	createMailbox(path: string): Promise<{ path: string; created: boolean }>;
	/**
	 * Delete a mailbox.
	 */
	deleteMailbox(path: string): Promise<{ path: string }>;
	/**
	 * Rename a mailbox.
	 */
	renameMailbox(
		oldPath: string,
		newPath: string,
	): Promise<{ path: string; newPath: string }>;
	/**
	 * Subscribe to a mailbox.
	 */
	subscribeMailbox(path: string): Promise<void>;
	/**
	 * Unsubscribe from a mailbox.
	 */
	unsubscribeMailbox(path: string): Promise<void>;
	/**
	 * Move messages to another mailbox.
	 * Returns mapping of source UIDs to destination UIDs.
	 * Requires mailbox to be open.
	 *
	 * @param uids - Array of message UIDs to move
	 * @param destination - Destination mailbox path
	 * @returns Object with destination path, uidValidity, and uidMap
	 */
	moveMessages(
		uids: number[],
		destination: string,
	): Promise<{
		destination: string;
		uidValidity: number;
		uidMap: Map<number, number>;
	}>;
	/**
	 * Copy messages to another mailbox.
	 * Returns mapping of source UIDs to destination UIDs.
	 * Requires mailbox to be open.
	 *
	 * @param uids - Array of message UIDs to copy
	 * @param destination - Destination mailbox path
	 * @returns Object with destination path, uidValidity, and uidMap
	 */
	copyMessages(
		uids: number[],
		destination: string,
	): Promise<{
		destination: string;
		uidValidity: number;
		uidMap: Map<number, number>;
	}>;
	/**
	 * Permanently delete messages (mark \Deleted + expunge).
	 * Requires mailbox to be open.
	 *
	 * @param uids - Array of message UIDs to delete
	 * @returns Number of messages deleted
	 */
	deleteMessages(uids: number[]): Promise<number>;
	/**
	 * Get mailbox status without opening it.
	 * Uses IMAP STATUS command to get message counts.
	 *
	 * @param mailboxPath - Full path to the mailbox
	 * @returns Mailbox status including unseen count
	 */
	getMailboxStatus(mailboxPath: string): Promise<ImapMailboxStatus>;
	/**
	 * Append a message to a mailbox via IMAP APPEND command.
	 *
	 * @param mailbox - Full path of the target mailbox
	 * @param message - RFC 822 message content
	 * @param flags - Optional flags to set on the message
	 * @returns Object with destination path, uidValidity, and uid of the appended message
	 */
	append(
		mailbox: string,
		message: string | Buffer,
		flags?: string[],
	): Promise<{
		destination: string;
		uidValidity: number;
		uid: number;
	}>;
}
