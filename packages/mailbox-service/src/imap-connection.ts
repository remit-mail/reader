/**
 * Promise-based wrapper around node-imap
 */

import Imap from "node-imap";
import type {
	FlatMailboxInfo,
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

			this.imap.once("end", () => {
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

			this.imap?.closeBox(expunge, (err) => {
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
	search = (criteria: any[]): Promise<number[]> => {
		return new Promise((resolve, reject) => {
			if (!this.imap || this.state !== "authenticated") {
				reject(new Error("Not connected"));
				return;
			}

			this.imap.search(criteria, (err, uids) => {
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
			const f = this.imap.fetch(uids, {
				envelope: true,
				struct: true,
			});

			f.on("message", (msg, seqno) => {
				const message: Partial<ImapMessage> = {
					seq: seqno,
					flags: [],
				};

				msg.on("attributes", (attrs) => {
					message.uid = attrs.uid;
					message.flags = attrs.flags;
					message.internalDate = attrs.date;
					message.size = attrs.size;
					message.envelope = (attrs as any).envelope;
				});

				msg.once("end", () => {
					if (message.uid) {
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
