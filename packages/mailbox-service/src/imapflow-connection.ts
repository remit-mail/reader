/**
 * ImapFlow-based IMAP connection
 *
 * Modern async/await replacement for the node-imap based ImapConnection.
 * Provides the same interface but uses ImapFlow under the hood.
 */

import { ImapFlow } from "imapflow";
import type {
	FlatMailboxInfo,
	ImapAddress,
	ImapBoxStatus,
	ImapConnectionConfig,
	ImapConnectionState,
	ImapMailbox,
	ImapMessage,
	ImapNamespaces,
} from "./types.js";

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
	 * Connect to the IMAP server
	 */
	connect = async (): Promise<void> => {
		if (this.client) {
			throw new Error("Already connected");
		}

		this._state = "connecting";

		// Determine TLS options
		// When secure is false, STARTTLS may still be used, so we need to handle self-signed certs
		const tlsOptions = this.config.tlsOptions
			? {
					rejectUnauthorized:
						this.config.tlsOptions.rejectUnauthorized ?? true,
				}
			: !this.config.tls
				? {
						// Allow self-signed certs when TLS is disabled (for STARTTLS)
						rejectUnauthorized: false,
					}
				: undefined;

		this.client = new ImapFlow({
			host: this.config.host,
			port: this.config.port,
			secure: this.config.tls,
			servername: this.config.tlsOptions?.servername,
			auth: {
				user: this.config.user,
				pass: this.config.password,
			},
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
	 * List all mailboxes
	 *
	 * @param nsPrefix - Optional namespace prefix to list mailboxes from
	 */
	getBoxes = async (
		nsPrefix?: string,
	): Promise<Record<string, ImapMailbox>> => {
		this.ensureConnected();

		const mailboxes = await this.client!.list();

		// Convert ImapFlow's flat list to node-imap's nested structure
		const result: Record<string, ImapMailbox> = {};

		for (const mailbox of mailboxes) {
			// Filter by namespace prefix if provided
			if (nsPrefix !== undefined) {
				if (!mailbox.path.startsWith(nsPrefix)) {
					continue;
				}
			}

			// Build nested structure
			const pathParts = mailbox.path.split(mailbox.delimiter);
			let current = result;

			for (let i = 0; i < pathParts.length; i++) {
				const part = pathParts[i];
				const isLast = i === pathParts.length - 1;

				if (!current[part]) {
					current[part] = {
						attribs: isLast ? this.convertFlags(mailbox.flags) : [],
						delimiter: mailbox.delimiter,
						children: null,
						parent: null,
					};
				}

				if (isLast) {
					current[part].attribs = this.convertFlags(mailbox.flags);
				} else {
					if (!current[part].children) {
						current[part].children = {};
					}
					current = current[part].children!;
				}
			}
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

		const mailbox = await this.client!.mailboxOpen(mailboxPath, {
			readOnly,
		});

		this.currentMailbox = mailboxPath;

		// Extract mailbox name from path
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
			await this.client!.mailboxClose();
			this.currentMailbox = null;
		}
	};

	/**
	 * Flatten nested mailbox structure into a list
	 */
	flattenBoxes = (
		boxes: Record<string, ImapMailbox>,
		parentPath = "",
	): FlatMailboxInfo[] => {
		const result: FlatMailboxInfo[] = [];

		for (const [name, box] of Object.entries(boxes)) {
			const fullPath = parentPath
				? `${parentPath}${box.delimiter}${name}`
				: name;

			result.push({
				fullPath,
				name,
				delimiter: box.delimiter,
				attributes: box.attribs,
				parentPath: parentPath || null,
			});

			if (box.children) {
				result.push(...this.flattenBoxes(box.children, fullPath));
			}
		}

		return result;
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

		const result = await this.client!.search(searchQuery, { uid: true });
		// search can return false if no messages match
		return result === false ? [] : result;
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

		if (!this.currentMailbox) {
			throw new Error("No mailbox selected");
		}

		if (uids.length === 0) {
			return [];
		}

		const messages: ImapMessage[] = [];

		// ImapFlow fetch with native envelope support
		const uidRange = uids.join(",");

		for await (const msg of this.client!.fetch(uidRange, {
			uid: true,
			flags: true,
			envelope: true,
			internalDate: true,
			size: true,
		}, { uid: true })) {
			// Convert internalDate to Date object
			let internalDate: Date;
			if (msg.internalDate instanceof Date) {
				internalDate = msg.internalDate;
			} else if (typeof msg.internalDate === "string") {
				internalDate = new Date(msg.internalDate);
			} else {
				internalDate = new Date();
			}

			messages.push({
				uid: msg.uid,
				seq: msg.seq,
				flags: Array.from(msg.flags || []),
				internalDate,
				size: msg.size ?? 0,
				envelope: this.convertEnvelope(msg.envelope),
			});
		}

		return messages;
	};

	/**
	 * Convert ImapFlow envelope to our ImapEnvelope format
	 */
	private convertEnvelope = (
		envelope: {
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
		} | undefined,
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
	 * Ensure the connection is established
	 */
	private ensureConnected = (): void => {
		if (!this.client || this._state !== "authenticated") {
			throw new Error("Not connected to IMAP server");
		}
	};
}

/**
 * Create an ImapFlow connection from account data
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
		password,
	});
};
