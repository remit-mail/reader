/**
 * Promise-based wrapper around node-imap
 */

import Imap from "node-imap";
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
 * Promise-based IMAP connection wrapper
 *
 * Wraps node-imap with a cleaner async/await API and proper error handling.
 */
export class ImapConnection {
	private imap: Imap | null = null;
	private _state: ImapConnectionState = "disconnected";
	private config: ImapConnectionConfig;

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
	connect = (): Promise<void> => {
		return new Promise((resolve, reject) => {
			if (this.imap) {
				reject(new Error("Already connected"));
				return;
			}

			this._state = "connecting";

			this.imap = new Imap({
				user: this.config.user,
				password: this.config.password,
				host: this.config.host,
				port: this.config.port,
				tls: this.config.tls,
				tlsOptions: this.config.tlsOptions,
				connTimeout: this.config.connTimeout ?? 30000,
				authTimeout: this.config.authTimeout ?? 15000,
				// Force NOOP instead of IDLE to work around IMAP servers
				// that don't handle IDLE/DONE correctly (e.g., mokapi)
				keepalive: { forceNoop: true },
			});

			this.imap.once("ready", () => {
				this._state = "authenticated";
				resolve();
			});

			this.imap.once("error", (err: Error) => {
				this._state = "error";
				reject(err);
			});

			this.imap.once("end", () => {
				this._state = "disconnected";
				this.imap = null;
			});

			this.imap.connect();
		});
	};

	/**
	 * Disconnect from the IMAP server
	 */
	disconnect = (): Promise<void> => {
		return new Promise((resolve) => {
			if (!this.imap) {
				resolve();
				return;
			}

			// Timeout in case server doesn't respond to LOGOUT
			const timeout = setTimeout(() => {
				this._state = "disconnected";
				this.imap = null;
				resolve();
			}, 5000);

			this.imap.once("end", () => {
				clearTimeout(timeout);
				this._state = "disconnected";
				this.imap = null;
				resolve();
			});

			this.imap.end();
		});
	};

	/**
	 * Get IMAP namespaces
	 */
	getNamespaces = (): Promise<ImapNamespaces> => {
		return new Promise((resolve, _reject) => {
			this.ensureConnected();

			// node-imap exposes namespaces as a property after connection
			const ns = this.imap?.namespaces;

			if (!ns) {
				// Return default namespace if server doesn't support NAMESPACE
				resolve({
					personal: [{ prefix: "", delimiter: "/" }],
					other: [],
					shared: [],
				});
				return;
			}

			resolve({
				personal: ns.personal ?? [],
				other: ns.other ?? [],
				shared: ns.shared ?? [],
			});
		});
	};

	/**
	 * List all mailboxes
	 *
	 * @param nsPrefix - Optional namespace prefix to list mailboxes from
	 */
	getBoxes = (nsPrefix?: string): Promise<Record<string, ImapMailbox>> => {
		return new Promise((resolve, reject) => {
			this.ensureConnected();

			const callback = (
				err: Error | null,
				boxes: Record<string, ImapMailbox>,
			) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(boxes);
			};

			if (nsPrefix !== undefined) {
				this.imap?.getBoxes(nsPrefix, callback);
			} else {
				this.imap?.getBoxes(callback);
			}
		});
	};

	/**
	 * Open a mailbox for reading
	 *
	 * @param mailboxPath - Full path to the mailbox (e.g., "INBOX", "[Gmail]/Sent")
	 * @param readOnly - Whether to open read-only (default: true)
	 */
	openBox = (mailboxPath: string, readOnly = true): Promise<ImapBoxStatus> => {
		return new Promise((resolve, reject) => {
			this.ensureConnected();

			this.imap?.openBox(mailboxPath, readOnly, (err, box) => {
				if (err) {
					reject(err);
					return;
				}

				resolve({
					name: box.name,
					readOnly: box.readOnly ?? readOnly,
					uidvalidity: box.uidvalidity,
					uidnext: box.uidnext,
					flags: box.flags,
					permFlags: box.permFlags,
					persistentUIDs: box.persistentUIDs,
					messages: {
						total: box.messages.total,
						new: box.messages.new,
					},
					newKeywords: box.newKeywords,
				});
			});
		});
	};

	/**
	 * Close the currently open mailbox
	 *
	 * @param expunge - Whether to permanently remove deleted messages
	 */
	closeBox = (expunge = false): Promise<void> => {
		return new Promise((resolve, reject) => {
			this.ensureConnected();

			// Handle connection errors during closeBox
			const errorHandler = (err: Error) => {
				reject(err);
			};
			this.imap?.once("error", errorHandler);

			this.imap?.closeBox(expunge, (err) => {
				this.imap?.removeListener("error", errorHandler);
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});
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
	 * Ensure the connection is established
	 */
	private ensureConnected = (): void => {
		if (!this.imap || this._state !== "authenticated") {
			throw new Error("Not connected to IMAP server");
		}
	};

	/**
	 * Search for messages
	 */
	search = (criteria: unknown[]): Promise<number[]> => {
		return new Promise((resolve, reject) => {
			if (!this.imap || this.state !== "authenticated") {
				reject(new Error("Not connected"));
				return;
			}

			// Handle connection errors during search
			const errorHandler = (err: Error) => {
				reject(err);
			};
			const endHandler = () => {
				reject(new Error("Connection ended"));
			};

			this.imap.once("error", errorHandler);
			this.imap.once("end", endHandler);

			// biome-ignore lint/suspicious/noExplicitAny: node-imap expects any[]
			this.imap.search(criteria as any[], (err, uids) => {
				this.imap?.removeListener("error", errorHandler);
				this.imap?.removeListener("end", endHandler);
				if (err) {
					reject(err);
					return;
				}
				resolve(uids);
			});
		});
	};

	/**
	 * Fetch messages by UID
	 *
	 * Uses HEADER.FIELDS to fetch envelope data since some IMAP servers
	 * (like mokapi) don't support the ENVELOPE fetch item properly.
	 */
	fetchMessages = (uids: number[]): Promise<ImapMessage[]> => {
		return new Promise((resolve, reject) => {
			if (!this.imap || this.state !== "authenticated") {
				reject(new Error("Not connected"));
				return;
			}

			if (uids.length === 0) {
				resolve([]);
				return;
			}

			const messages: ImapMessage[] = [];

			// Request headers instead of envelope for broader compatibility
			const f = this.imap.fetch(uids, {
				bodies:
					"HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE MESSAGE-ID IN-REPLY-TO SENDER REPLY-TO)",
				struct: true,
			});

			f.on("message", (msg, seqno) => {
				const message: Partial<ImapMessage> = {
					seq: seqno,
					flags: [],
				};
				let headerBuffer = "";

				msg.on("body", (stream) => {
					stream.on("data", (chunk: Buffer) => {
						headerBuffer += chunk.toString("utf8");
					});
				});

				msg.on("attributes", (attrs) => {
					message.uid = attrs.uid;
					message.flags = attrs.flags;
					message.internalDate = attrs.date;
					message.size = attrs.size;
				});

				msg.once("end", () => {
					if (message.uid) {
						// Parse headers into envelope
						message.envelope = this.parseHeadersToEnvelope(headerBuffer);
						messages.push(message as ImapMessage);
					}
				});
			});

			f.once("error", (err) => {
				reject(err);
			});

			f.once("end", () => {
				resolve(messages);
			});
		});
	};

	/**
	 * Parse raw header text into an envelope-like structure
	 */
	private parseHeadersToEnvelope = (
		headers: string,
	): ImapMessage["envelope"] => {
		const lines = headers.split(/\r?\n/);
		const headerMap: Record<string, string> = {};

		let currentHeader = "";
		let currentValue = "";

		for (const line of lines) {
			if (line.match(/^\s/)) {
				// Continuation of previous header
				currentValue += ` ${line.trim()}`;
			} else if (line.includes(":")) {
				// Save previous header
				if (currentHeader) {
					headerMap[currentHeader.toLowerCase()] = currentValue;
				}
				const colonIdx = line.indexOf(":");
				currentHeader = line.substring(0, colonIdx);
				currentValue = line.substring(colonIdx + 1).trim();
			}
		}
		// Save last header
		if (currentHeader) {
			headerMap[currentHeader.toLowerCase()] = currentValue;
		}

		return {
			date: headerMap.date || "",
			subject: headerMap.subject || "",
			from: this.parseAddressList(headerMap.from),
			sender: this.parseAddressList(headerMap.sender),
			replyTo: this.parseAddressList(headerMap["reply-to"]),
			to: this.parseAddressList(headerMap.to),
			cc: this.parseAddressList(headerMap.cc),
			bcc: this.parseAddressList(headerMap.bcc),
			inReplyTo: headerMap["in-reply-to"] || "",
			messageId: headerMap["message-id"] || "",
		};
	};

	/**
	 * Parse an address list header into ImapAddress array
	 * Handles formats like: "Name <email@example.com>, other@example.com"
	 */
	private parseAddressList = (header: string | undefined): ImapAddress[] => {
		if (!header) return [];

		const addresses: ImapAddress[] = [];

		// Split by comma and parse each address
		const parts = header.split(/,\s*/);

		for (const part of parts) {
			const trimmed = part.trim();
			if (!trimmed) continue;

			// Try "Name <email@domain>" format first
			const namedMatch = trimmed.match(
				/^(?:"?([^"<]+)"?\s+)?<([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>$/,
			);
			if (namedMatch) {
				addresses.push({
					name: namedMatch[1]?.trim() || undefined,
					mailbox: namedMatch[2],
					host: namedMatch[3],
				});
				continue;
			}

			// Try plain "email@domain" format
			const plainMatch = trimmed.match(
				/^([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/,
			);
			if (plainMatch) {
				addresses.push({
					name: undefined,
					mailbox: plainMatch[1],
					host: plainMatch[2],
				});
			}
		}

		return addresses;
	};
}

/**
 * Create an IMAP connection from account data
 */
export const createImapConnectionFromAccount = (
	account: {
		imapHost: string;
		imapPort: number;
		imapTls: boolean;
		username: string;
	},
	password: string,
): ImapConnection => {
	return new ImapConnection({
		host: account.imapHost,
		port: account.imapPort,
		tls: account.imapTls,
		user: account.username,
		password,
	});
};
