/**
 * ImapFlow-based IMAP connection
 *
 * Modern async/await replacement for the node-imap based ImapConnection.
 * Provides the same interface but uses ImapFlow under the hood.
 */

import { Readable } from "node:stream";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type {
	FlatMailboxInfo,
	ImapAddress,
	ImapBoxStatus,
	ImapConnectionConfig,
	ImapConnectionState,
	ImapMailboxStatus,
	ImapMessage,
	ImapNamespaces,
	MailCredentials,
} from "./types.js";
import { MailConnectionError } from "./types.js";

/**
 * ImapFlow-based IMAP connection
 *
 * Drop-in replacement for ImapConnection using the ImapFlow library.
 * Benefits:
 * - Native async/await API (no callback wrapping)
 * - Built-in envelope parsing that works with mokapi
 * - Proper IDLE support with events
 * - Built-in TypeScript types
 * - Active maintenance
 */
export class ImapFlowConnection {
	private client: ImapFlow | null = null;
	private _state: ImapConnectionState = "disconnected";
	private config: ImapConnectionConfig;
	private currentMailbox: string | null = null;

	constructor(config: ImapConnectionConfig) {
		this.config = config;
	}

	/**
	 * Current connection state
	 */
	get state(): ImapConnectionState {
		return this._state;
	}

	/**
	 * Whether the connection is established and authenticated
	 */
	get isConnected(): boolean {
		return this._state === "authenticated";
	}

	/**
	 * Connect to the IMAP server with retry logic.
	 *
	 * Retries up to 3 times with exponential backoff (1s, 2s, 4s) on connection errors.
	 * Authentication errors are not retried.
	 */
	connect = async (): Promise<void> => {
		if (this.client) {
			throw new Error("Already connected");
		}

		const maxRetries = 3;
		const baseDelayMs = 1000;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				await this.attemptConnect();
				return;
			} catch (error) {
				const classified = classifyImapError(
					error,
					`${this.config.host}:${this.config.port}`,
				);

				// Auth errors won't fix themselves on retry — throw immediately.
				if (classified?.kind === "auth") {
					throw classified;
				}

				// Final attempt exhausted: throw the classified error if we have
				// one (network failures), otherwise let the raw error bubble.
				if (attempt === maxRetries) {
					throw classified ?? error;
				}

				// Network and unknown errors fall through to retry-with-backoff.
				// Exponential backoff: 1s, 2s, 4s
				const delay = baseDelayMs * 2 ** (attempt - 1);
				await this.sleep(delay);

				// Reset state for retry
				this.cleanup();
			}
		}
	};

	/**
	 * Single connection attempt
	 */
	private attemptConnect = async (): Promise<void> => {
		this._state = "connecting";

		// Determine TLS options
		// When secure is false, STARTTLS may still be used, so we need to handle self-signed certs
		const tlsOptions = this.config.tlsOptions
			? {
					rejectUnauthorized: this.config.tlsOptions.rejectUnauthorized ?? true,
				}
			: !this.config.tls
				? {
						// Allow self-signed certs when TLS is disabled (for STARTTLS)
						rejectUnauthorized: false,
					}
				: undefined;

		const auth = buildImapAuth(this.config.user, this.config.credentials);

		this.client = new ImapFlow({
			host: this.config.host,
			port: this.config.port,
			secure: this.config.tls,
			servername: this.config.tlsOptions?.servername,
			auth,
			tls: tlsOptions,
			// Disable auto IDLE to work around servers that don't handle IDLE correctly
			// This is equivalent to node-imap's forceNoop: true
			disableAutoIdle: true,
			logger: false, // Disable verbose logging
		});

		this.client.on("close", () => {
			this._state = "disconnected";
			this.client = null;
			this.currentMailbox = null;
		});

		this.client.on("error", () => {
			this._state = "error";
		});

		await this.client.connect();
		this._state = "authenticated";
	};

	/**
	 * Cleanup client state for retry
	 */
	private cleanup = (): void => {
		if (this.client) {
			this.client.close();
			this.client = null;
		}
		this._state = "disconnected";
		this.currentMailbox = null;
	};

	/**
	 * Sleep for a specified duration
	 */
	private sleep = (ms: number): Promise<void> =>
		new Promise((resolve) => setTimeout(resolve, ms));

	/**
	 * Disconnect from the IMAP server
	 */
	disconnect = async (): Promise<void> => {
		if (!this.client) {
			return;
		}

		const client = this.client;

		// Use a timeout to avoid hanging on logout
		const timeoutPromise = new Promise<void>((resolve) => {
			setTimeout(() => {
				// Force close if logout doesn't complete
				client.close();
				resolve();
			}, 5000);
		});

		try {
			await Promise.race([client.logout(), timeoutPromise]);
		} catch {
			// Ignore errors during disconnect, force close
			client.close();
		} finally {
			this._state = "disconnected";
			this.client = null;
			this.currentMailbox = null;
		}
	};

	/**
	 * Get IMAP namespaces
	 *
	 * Note: ImapFlow doesn't expose namespaces directly, so we return
	 * the default namespace. The mailbox listing works without explicit
	 * namespace handling in ImapFlow.
	 */
	getNamespaces = async (): Promise<ImapNamespaces> => {
		this.ensureConnected();

		// ImapFlow doesn't expose NAMESPACE info, return defaults
		// This is sufficient as ImapFlow handles namespaces internally
		return {
			personal: [{ prefix: "", delimiter: "/" }],
			other: [],
			shared: [],
		};
	};

	/**
	 * List all mailboxes as a flat list, preserving original paths from server.
	 * This avoids path corruption from split/join operations.
	 *
	 * @param nsPrefix - Optional namespace prefix to filter mailboxes
	 */
	listMailboxes = async (nsPrefix?: string): Promise<FlatMailboxInfo[]> => {
		this.ensureConnected();

		const mailboxes = await this.client?.list();
		if (!mailboxes) {
			return [];
		}
		const result: FlatMailboxInfo[] = [];

		for (const mailbox of mailboxes) {
			// Filter by namespace prefix if provided
			if (nsPrefix !== undefined && !mailbox.path.startsWith(nsPrefix)) {
				continue;
			}

			// Extract name from path (last component)
			const pathParts = mailbox.path.split(mailbox.delimiter);
			const name = pathParts[pathParts.length - 1] || mailbox.path;
			const parentPath =
				pathParts.length > 1
					? pathParts.slice(0, -1).join(mailbox.delimiter)
					: null;

			result.push({
				fullPath: mailbox.path, // Use original path from server
				name,
				delimiter: mailbox.delimiter,
				attributes: this.convertFlags(mailbox.flags),
				parentPath,
			});
		}

		return result;
	};

	/**
	 * Convert ImapFlow flags Set to string array
	 */
	private convertFlags = (flags: Set<string> | undefined): string[] => {
		if (!flags) return [];
		return Array.from(flags);
	};

	/**
	 * Open a mailbox for reading
	 *
	 * @param mailboxPath - Full path to the mailbox (e.g., "INBOX", "[Gmail]/Sent")
	 * @param readOnly - Whether to open read-only (default: true)
	 */
	openBox = async (
		mailboxPath: string,
		readOnly = true,
	): Promise<ImapBoxStatus> => {
		this.ensureConnected();

		// Idempotency guard: re-selecting the currently-open mailbox is a no-op
		// SELECT on the wire. `mailbox` exposes the live, already-selected box, so
		// we can return its status without paying for another round-trip — this is
		// what lets a batch issue one SELECT and many fetches on the same box.
		if (this.currentMailbox === mailboxPath && this.client?.mailbox) {
			return this.toBoxStatus(this.client.mailbox, readOnly);
		}

		const mailbox = await this.client?.mailboxOpen(mailboxPath, {
			readOnly,
		});

		if (!mailbox) {
			throw new Error(`Failed to open mailbox: ${mailboxPath}`);
		}

		this.currentMailbox = mailboxPath;

		return this.toBoxStatus(mailbox, readOnly);
	};

	/**
	 * Build an ImapBoxStatus from an imapflow MailboxObject.
	 */
	private toBoxStatus = (
		mailbox: {
			path: string;
			delimiter: string;
			flags: Set<string>;
			permanentFlags?: Set<string>;
			uidValidity: bigint;
			uidNext: number;
			exists: number;
			readOnly?: boolean;
		},
		readOnly: boolean,
	): ImapBoxStatus => {
		const pathParts = mailbox.path.split(mailbox.delimiter);
		const name = pathParts[pathParts.length - 1] || mailbox.path;

		return {
			name,
			readOnly: mailbox.readOnly ?? readOnly,
			uidvalidity: Number(mailbox.uidValidity),
			uidnext: mailbox.uidNext,
			flags: Array.from(mailbox.flags || []),
			permFlags: Array.from(mailbox.permanentFlags || []),
			persistentUIDs: true, // ImapFlow assumes persistent UIDs
			messages: {
				total: mailbox.exists,
				new: 0, // ImapFlow doesn't provide unseen count on open
			},
			newKeywords: mailbox.permanentFlags?.has("\\*") ?? false,
		};
	};

	/**
	 * Close the currently open mailbox
	 *
	 * @param _expunge - Whether to permanently remove deleted messages (not used in ImapFlow)
	 */
	closeBox = async (_expunge = false): Promise<void> => {
		this.ensureConnected();

		if (this.currentMailbox) {
			await this.client?.mailboxClose();
			this.currentMailbox = null;
		}
	};

	/**
	 * Search for messages
	 */
	search = async (criteria: unknown[]): Promise<number[]> => {
		this.ensureConnected();

		if (!this.currentMailbox) {
			throw new Error("No mailbox selected");
		}

		// Convert node-imap style criteria to ImapFlow search object
		const searchQuery = this.convertSearchCriteria(criteria);

		const result = await this.client?.search(searchQuery, { uid: true });
		// search can return false if no messages match, or undefined if client is null
		if (!result) {
			return [];
		}
		return result;
	};

	/**
	 * Convert node-imap style search criteria to ImapFlow format
	 */
	private convertSearchCriteria = (
		criteria: unknown[],
	): Record<string, unknown> => {
		const result: Record<string, unknown> = {};

		for (const criterion of criteria) {
			if (typeof criterion === "string") {
				// Simple flags like "ALL", "UNSEEN", etc.
				switch (criterion.toUpperCase()) {
					case "ALL":
						// ALL is default, no filter needed
						break;
					case "UNSEEN":
						result.seen = false;
						break;
					case "SEEN":
						result.seen = true;
						break;
					case "FLAGGED":
						result.flagged = true;
						break;
					case "UNFLAGGED":
						result.flagged = false;
						break;
					case "DELETED":
						result.deleted = true;
						break;
					case "UNDELETED":
						result.deleted = false;
						break;
					case "ANSWERED":
						result.answered = true;
						break;
					case "UNANSWERED":
						result.answered = false;
						break;
					case "DRAFT":
						result.draft = true;
						break;
					case "UNDRAFT":
						result.draft = false;
						break;
				}
			} else if (Array.isArray(criterion)) {
				// Criteria with values like ["UID", "1:*"]
				const [key, value] = criterion;
				if (typeof key === "string") {
					switch (key.toUpperCase()) {
						case "UID":
							result.uid = value;
							break;
						case "FROM":
							result.from = value;
							break;
						case "TO":
							result.to = value;
							break;
						case "SUBJECT":
							result.subject = value;
							break;
						case "SINCE":
							result.since = value;
							break;
						case "BEFORE":
							result.before = value;
							break;
					}
				}
			}
		}

		return result;
	};

	/**
	 * Fetch messages by UID
	 *
	 * Uses ImapFlow's native envelope parsing which works correctly
	 * with all IMAP servers including mokapi.
	 */
	fetchMessages = async (uids: number[]): Promise<ImapMessage[]> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		if (!this.currentMailbox) {
			throw new Error("No mailbox selected");
		}

		if (uids.length === 0) {
			return [];
		}

		const messages: ImapMessage[] = [];

		// ImapFlow fetch with native envelope support + References header
		const uidRange = uids.join(",");

		const fetchIterator = client.fetch(
			uidRange,
			{
				uid: true,
				flags: true,
				envelope: true,
				bodyStructure: true,
				internalDate: true,
				size: true,
				headers: ["references"],
			},
			{ uid: true },
		);

		// Connection may have been lost - fetch returns an async iterable
		if (!fetchIterator) {
			throw new Error(
				`IMAP connection lost while fetching messages: ${uidRange}`,
			);
		}

		for await (const msg of fetchIterator) {
			// imapflow occasionally yields a row with undefined uid or internalDate
			// on back-to-back FETCH calls (e.g. after a body-fetch on the same UID).
			// Skipping the row is safe: the caller asked for a specific UID set and
			// will simply not see that entry rather than the whole call crashing.
			// See #408 for the investigation.
			if (msg.uid == null || msg.internalDate == null) {
				continue;
			}

			// Convert internalDate to Date object
			let internalDate: Date;
			if (msg.internalDate instanceof Date) {
				internalDate = msg.internalDate;
			} else if (typeof msg.internalDate === "string") {
				internalDate = new Date(msg.internalDate);
			} else if (typeof msg.internalDate === "number") {
				internalDate = new Date(msg.internalDate);
			} else {
				throw new Error(
					`Unexpected internalDate type for UID ${msg.uid}: ${typeof msg.internalDate} (value: ${JSON.stringify(msg.internalDate)})`,
				);
			}

			// Parse References header if present
			const references = await this.parseReferencesHeader(msg.headers);

			messages.push({
				uid: msg.uid,
				seq: msg.seq,
				flags: Array.from(msg.flags || []),
				internalDate,
				size: msg.size ?? 0,
				envelope: this.convertEnvelope(msg.envelope),
				references,
				bodyStructure: msg.bodyStructure,
			});
		}

		return messages;
	};

	/**
	 * Fetch the full message body (RFC822 source) for a single message by UID.
	 *
	 * @param uid - The UID of the message to fetch
	 * @returns The raw message body as a Buffer
	 */
	fetchMessageBody = async (uid: number): Promise<Buffer> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		if (!this.currentMailbox) {
			throw new Error("No mailbox selected");
		}

		const result = await client.download(String(uid), undefined, {
			uid: true,
		});

		// Connection may have been lost during download
		if (!result || !result.content) {
			throw new Error(
				`IMAP connection lost while downloading message UID ${uid}`,
			);
		}

		const chunks: Buffer[] = [];
		for await (const chunk of result.content) {
			chunks.push(chunk);
		}

		return Buffer.concat(chunks);
	};

	/**
	 * Fetch full message bodies (RFC822 source) for many UIDs in ONE pipelined
	 * ranged UID FETCH on a single connection — the desktop-client pattern.
	 *
	 * Mirrors `fetchMessages`: one comma-joined UID range, one `client.fetch`,
	 * one SELECT (the caller opens the box once for the whole batch). Yields
	 * `{ uid, source }` as each message arrives so the caller can stream each
	 * body straight to storage without buffering the whole batch.
	 *
	 * `source` is a readable stream over the message bytes — callers must
	 * consume it (e.g. pipe to an upload) before requesting the next item.
	 */
	async *fetchMessageBodies(
		uids: number[],
	): AsyncGenerator<{ uid: number; source: Readable }> {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		if (!this.currentMailbox) {
			throw new Error("No mailbox selected");
		}

		if (uids.length === 0) {
			return;
		}

		const uidRange = uids.join(",");

		const fetchIterator = client.fetch(
			uidRange,
			{ uid: true, source: true },
			{ uid: true },
		);

		if (!fetchIterator) {
			throw new MailConnectionError(
				"network",
				`IMAP connection lost while fetching message bodies: ${uidRange}`,
			);
		}

		try {
			for await (const msg of fetchIterator) {
				// imapflow can yield a row with an undefined uid or no source on
				// back-to-back FETCH calls; skip it rather than crash the batch — the
				// caller treats any UID it never sees as failed and re-enqueues it.
				// See #408.
				if (msg.uid == null || msg.source == null) {
					continue;
				}

				yield { uid: msg.uid, source: Readable.from(msg.source) };
			}
		} catch (error) {
			// A mid-stream socket drop surfaces as imapflow's
			// `new Error("Connection closed")` with code `EConnectionClosed` — a
			// string the rest of the code never matches on. Re-throw it as the
			// typed MailConnectionError so the caller's fail-fast path triggers and
			// re-enqueues the not-yet-yielded UIDs instead of failing the record.
			throw (
				classifyImapError(error, `${this.config.host}:${this.config.port}`) ??
				error
			);
		}
	}

	/**
	 * Parse the References header from IMAP headers buffer.
	 * Returns an array of Message-IDs, with the first being the thread root.
	 */
	private parseReferencesHeader = async (
		headers: Buffer | undefined,
	): Promise<string[] | undefined> => {
		if (!headers) return undefined;

		const parsed = await simpleParser(headers);

		if (!parsed.references) return undefined;

		// mailparser returns references as string or array
		if (Array.isArray(parsed.references)) {
			return parsed.references.length > 0 ? parsed.references : undefined;
		}

		// Single reference as string
		return [parsed.references];
	};

	/**
	 * Convert ImapFlow envelope to our ImapEnvelope format
	 */
	private convertEnvelope = (
		envelope:
			| {
					date?: Date;
					subject?: string;
					from?: Array<{ name?: string; address?: string }>;
					sender?: Array<{ name?: string; address?: string }>;
					replyTo?: Array<{ name?: string; address?: string }>;
					to?: Array<{ name?: string; address?: string }>;
					cc?: Array<{ name?: string; address?: string }>;
					bcc?: Array<{ name?: string; address?: string }>;
					inReplyTo?: string;
					messageId?: string;
			  }
			| undefined,
	): ImapMessage["envelope"] => {
		if (!envelope) {
			return {
				date: "",
				subject: "",
				from: [],
				sender: [],
				replyTo: [],
				to: [],
				cc: [],
				bcc: [],
				inReplyTo: "",
				messageId: "",
			};
		}

		const convertAddresses = (
			addrs?: Array<{ name?: string; address?: string }>,
		): ImapAddress[] => {
			if (!addrs) return [];
			return addrs
				.filter((a) => a.address)
				.map((a) => {
					const [mailbox, host] = (a.address || "").split("@");
					return {
						name: a.name || undefined,
						mailbox: mailbox || "",
						host: host || "",
					};
				});
		};

		return {
			date: envelope.date?.toISOString() ?? "",
			subject: envelope.subject ?? "",
			from: convertAddresses(envelope.from),
			sender: convertAddresses(envelope.sender),
			replyTo: convertAddresses(envelope.replyTo),
			to: convertAddresses(envelope.to),
			cc: convertAddresses(envelope.cc),
			bcc: convertAddresses(envelope.bcc),
			inReplyTo: envelope.inReplyTo ?? "",
			messageId: envelope.messageId ?? "",
		};
	};

	/**
	 * Add flags to messages by UID.
	 * Requires mailbox to be open (not read-only).
	 *
	 * @param uids - Array of message UIDs
	 * @param flags - Array of flags to add (e.g., ["\\Seen", "\\Flagged"])
	 */
	addFlags = async (uids: number[], flags: string[]): Promise<void> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		if (!this.currentMailbox) {
			throw new Error("No mailbox selected");
		}

		if (uids.length === 0 || flags.length === 0) {
			return;
		}

		const uidRange = uids.join(",");
		await client.messageFlagsAdd(uidRange, flags, { uid: true });
	};

	/**
	 * Remove flags from messages by UID.
	 * Requires mailbox to be open (not read-only).
	 *
	 * @param uids - Array of message UIDs
	 * @param flags - Array of flags to remove (e.g., ["\\Seen", "\\Flagged"])
	 */
	removeFlags = async (uids: number[], flags: string[]): Promise<void> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		if (!this.currentMailbox) {
			throw new Error("No mailbox selected");
		}

		if (uids.length === 0 || flags.length === 0) {
			return;
		}

		const uidRange = uids.join(",");
		await client.messageFlagsRemove(uidRange, flags, { uid: true });
	};

	/**
	 * Replace all flags on messages by UID.
	 * Requires mailbox to be open (not read-only).
	 *
	 * @param uids - Array of message UIDs
	 * @param flags - Array of flags to set (replaces all existing flags)
	 */
	setFlags = async (uids: number[], flags: string[]): Promise<void> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		if (!this.currentMailbox) {
			throw new Error("No mailbox selected");
		}

		if (uids.length === 0) {
			return;
		}

		const uidRange = uids.join(",");
		await client.messageFlagsSet(uidRange, flags, { uid: true });
	};

	/**
	 * Create a new mailbox.
	 *
	 * @param path - Full path of the mailbox to create (e.g., "Projects/ClientA")
	 * @returns Object with path and whether it was created (false if already exists)
	 */
	createMailbox = async (
		path: string,
	): Promise<{ path: string; created: boolean }> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		const result = await client.mailboxCreate(path);
		return {
			path: result.path,
			created: result.created ?? true,
		};
	};

	/**
	 * Delete a mailbox.
	 *
	 * @param path - Full path of the mailbox to delete
	 * @returns Object with the deleted path
	 */
	deleteMailbox = async (path: string): Promise<{ path: string }> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		// Cannot delete INBOX
		if (path.toUpperCase() === "INBOX") {
			throw new Error("Cannot delete INBOX");
		}

		const result = await client.mailboxDelete(path);
		return { path: result.path };
	};

	/**
	 * Rename a mailbox.
	 *
	 * @param oldPath - Current path of the mailbox
	 * @param newPath - New path for the mailbox
	 * @returns Object with old and new paths
	 */
	renameMailbox = async (
		oldPath: string,
		newPath: string,
	): Promise<{ path: string; newPath: string }> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		const result = await client.mailboxRename(oldPath, newPath);
		return {
			path: result.path,
			newPath: result.newPath,
		};
	};

	/**
	 * Subscribe to a mailbox.
	 *
	 * @param path - Full path of the mailbox to subscribe to
	 */
	subscribeMailbox = async (path: string): Promise<void> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		await client.mailboxSubscribe(path);
	};

	/**
	 * Unsubscribe from a mailbox.
	 *
	 * @param path - Full path of the mailbox to unsubscribe from
	 */
	unsubscribeMailbox = async (path: string): Promise<void> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		await client.mailboxUnsubscribe(path);
	};

	/**
	 * Move messages to another mailbox.
	 * Uses ImapFlow's messageMove which wraps UID MOVE command.
	 * Returns mapping of source UIDs to destination UIDs from COPYUID response.
	 *
	 * @param uids - Array of message UIDs to move
	 * @param destination - Destination mailbox path
	 * @returns Object with destination path, uidValidity, and uidMap
	 */
	moveMessages = async (
		uids: number[],
		destination: string,
	): Promise<{
		destination: string;
		uidValidity: number;
		uidMap: Map<number, number>;
	}> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		if (!this.currentMailbox) {
			throw new Error("No mailbox selected");
		}

		if (uids.length === 0) {
			return { destination, uidValidity: 0, uidMap: new Map() };
		}

		const uidRange = uids.join(",");
		const result = await client.messageMove(uidRange, destination, {
			uid: true,
		});

		// messageMove returns false if no messages were moved
		if (result === false) {
			return { destination, uidValidity: 0, uidMap: new Map() };
		}

		return {
			destination: result.destination,
			uidValidity: Number(result.uidValidity ?? 0),
			uidMap: result.uidMap ?? new Map(),
		};
	};

	/**
	 * Copy messages to another mailbox.
	 * Uses ImapFlow's messageCopy which wraps UID COPY command.
	 * Returns mapping of source UIDs to destination UIDs from COPYUID response.
	 *
	 * @param uids - Array of message UIDs to copy
	 * @param destination - Destination mailbox path
	 * @returns Object with destination path, uidValidity, and uidMap
	 */
	copyMessages = async (
		uids: number[],
		destination: string,
	): Promise<{
		destination: string;
		uidValidity: number;
		uidMap: Map<number, number>;
	}> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		if (!this.currentMailbox) {
			throw new Error("No mailbox selected");
		}

		if (uids.length === 0) {
			return { destination, uidValidity: 0, uidMap: new Map() };
		}

		const uidRange = uids.join(",");
		const result = await client.messageCopy(uidRange, destination, {
			uid: true,
		});

		// messageCopy returns false if no messages were copied
		if (result === false) {
			return { destination, uidValidity: 0, uidMap: new Map() };
		}

		return {
			destination: result.destination,
			uidValidity: Number(result.uidValidity ?? 0),
			uidMap: result.uidMap ?? new Map(),
		};
	};

	/**
	 * Permanently delete messages (mark \Deleted + expunge).
	 * Uses ImapFlow's messageDelete which wraps STORE +FLAGS.SILENT \Deleted
	 * followed by UID EXPUNGE.
	 *
	 * @param uids - Array of message UIDs to delete
	 * @returns Number of messages deleted
	 */
	deleteMessages = async (uids: number[]): Promise<number> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		if (!this.currentMailbox) {
			throw new Error("No mailbox selected");
		}

		if (uids.length === 0) {
			return 0;
		}

		const uidRange = uids.join(",");
		const result = await client.messageDelete(uidRange, { uid: true });

		// messageDelete returns boolean or deleted count
		if (typeof result === "number") {
			return result;
		}
		return result ? uids.length : 0;
	};

	/**
	 * Get mailbox status without opening it.
	 * Uses IMAP STATUS command to get message counts including unseen.
	 *
	 * @param mailboxPath - Full path to the mailbox
	 * @returns Mailbox status including unseen count
	 */
	getMailboxStatus = async (
		mailboxPath: string,
	): Promise<ImapMailboxStatus> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		const status = await client.status(mailboxPath, {
			messages: true,
			recent: true,
			unseen: true,
			uidNext: true,
			uidValidity: true,
			highestModseq: true,
		});

		return {
			messages: status.messages ?? 0,
			recent: status.recent ?? 0,
			unseen: status.unseen ?? 0,
			uidNext: status.uidNext ?? 0,
			uidValidity: Number(status.uidValidity ?? 0),
			highestModseq: Number(status.highestModseq ?? 0),
		};
	};

	/**
	 * Append a message to a mailbox.
	 * Used primarily for testing to seed messages.
	 *
	 * @param mailbox - Mailbox path to append to
	 * @param message - RFC 822 message content
	 * @param flags - Optional flags to set on the message
	 * @returns Object with destination path, uidValidity, and uid of the appended message
	 */
	append = async (
		mailbox: string,
		message: string | Buffer,
		flags?: string[],
	): Promise<{
		destination: string;
		uidValidity: number;
		uid: number;
	}> => {
		this.ensureConnected();
		const { client } = this;

		if (!client) {
			throw new Error("Not connected to IMAP server");
		}

		const result = await client.append(mailbox, message, flags);

		// append returns false if the message could not be appended
		if (result === false) {
			throw new Error(`Failed to append message to ${mailbox}`);
		}

		return {
			destination: result.destination,
			uidValidity: Number(result.uidValidity ?? 0),
			uid: result.uid ?? 0,
		};
	};

	/**
	 * Ensure the connection is established
	 */
	private ensureConnected = (): void => {
		if (!this.client || this._state !== "authenticated") {
			throw new Error("Not connected to IMAP server");
		}
	};
}

/**
 * Create an ImapFlow connection from account data using password credentials.
 */
export const createImapFlowConnectionFromAccount = (
	account: {
		imapHost: string;
		imapPort: number;
		imapTls: boolean;
		username: string;
	},
	password: string,
): ImapFlowConnection => {
	return new ImapFlowConnection({
		host: account.imapHost,
		port: account.imapPort,
		tls: account.imapTls,
		user: account.username,
		credentials: { kind: "password", password },
	});
};

/**
 * Create an ImapFlow connection using a credentials union (password or OAuth access token).
 */
export const createImapFlowConnectionWithCredentials = (
	account: {
		imapHost: string;
		imapPort: number;
		imapTls: boolean;
		username: string;
	},
	credentials: import("./types.js").MailCredentials,
): ImapFlowConnection => {
	return new ImapFlowConnection({
		host: account.imapHost,
		port: account.imapPort,
		tls: account.imapTls,
		user: account.username,
		credentials,
	});
};

/**
 * Build the imapflow auth object from mail credentials.
 *
 * IMPORTANT: never include access-token values in error messages.
 */
const buildImapAuth = (
	user: string,
	credentials: MailCredentials,
): { user: string; pass: string } | { user: string; accessToken: string } => {
	if (credentials.kind === "password") {
		return { user, pass: credentials.password };
	}
	if (credentials.kind === "accessToken") {
		return { user, accessToken: credentials.accessToken };
	}
	// Exhaustiveness check — fails to compile if a new credential kind is added
	// without handling it here.
	const _exhaustive: never = credentials;
	throw new Error(`Unknown credential kind: ${JSON.stringify(_exhaustive)}`);
};

/**
 * Classify a raw IMAP error into a MailConnectionError, or return null if
 * the error is not recognisable (let it bubble as-is).
 *
 * IMPORTANT: never include access-token values in error messages.
 */
const classifyImapError = (
	error: unknown,
	endpoint?: string,
): MailConnectionError | null => {
	if (!(error instanceof Error)) {
		return null;
	}

	const msg = error.message;
	const code = (error as NodeJS.ErrnoException).code ?? "";

	// Authentication failures
	if (
		msg.includes("Invalid credentials") ||
		msg.includes("Authentication failed") ||
		msg.includes("AUTHENTICATIONFAILED") ||
		msg.includes("AUTHENTICATE") ||
		(error as { authenticationFailed?: boolean }).authenticationFailed === true
	) {
		return new MailConnectionError("auth", "IMAP authentication failed");
	}

	// Network-level failures — NEVER include the original message as it may
	// echo back tokens in some server implementations. The endpoint (host:port)
	// is safe and makes DNS/connect failures self-describing.
	if (
		code === "ECONNREFUSED" ||
		code === "ETIMEDOUT" ||
		code === "ENOTFOUND" ||
		code === "ECONNRESET" ||
		code === "EHOSTUNREACH" ||
		// imapflow raises these when the socket is gone mid-command.
		code === "EConnectionClosed" ||
		code === "NoConnection"
	) {
		const where = endpoint ? ` (${endpoint})` : "";
		return new MailConnectionError(
			"network",
			`IMAP connection failed: ${code}${where}`,
		);
	}

	return null;
};
