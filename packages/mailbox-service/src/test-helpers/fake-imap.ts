import { Readable } from "node:stream";
import { simpleParser } from "mailparser";
import type {
	FlatMailboxInfo,
	IImapConnection,
	ImapAddress,
	ImapBodyStructure,
	ImapBoxStatus,
	ImapConnectionState,
	ImapEnvelopeSnapshot,
	ImapMailboxStatus,
	ImapMessage,
	ImapNamespaces,
} from "../types.js";

interface StoredMessage {
	raw: Buffer;
	flags: Set<string>;
	modseq: bigint;
	internalDate: Date;
}

interface Folder {
	uidValidity: number;
	uidNext: number;
	attributes: string[];
	subscribed: boolean;
	messages: Map<number, StoredMessage>;
}

export const eml = (headers: Record<string, string>, body = "body"): Buffer =>
	Buffer.from(
		[
			...Object.entries({
				From: "Sender <sender@example.com>",
				To: "me@example.com",
				Subject: "Hello",
				"Content-Type": "text/plain",
				...headers,
			})
				.filter(([, value]) => value !== "")
				.map(([name, value]) => `${name}: ${value}`),
			"",
			body,
		].join("\r\n"),
	);

const toAddresses = (
	value: { value: Array<{ name?: string; address?: string }> } | undefined,
): ImapAddress[] =>
	(value?.value ?? [])
		.filter((entry) => entry.address)
		.map((entry) => {
			const [mailbox, host] = (entry.address ?? "").split("@");
			return { name: entry.name || undefined, mailbox, host };
		});

const single = <T>(value: T | T[] | undefined): T | undefined =>
	Array.isArray(value) ? value[0] : value;

/**
 * An IMAP server held in memory, behind the same connection port the real
 * imapflow adapter implements. FETCH rows are derived from the raw bytes the
 * way the adapter derives them: the envelope carries the header values as
 * written, angle brackets included, and References goes through mailparser.
 */
export class FakeImapServer {
	readonly folders = new Map<string, Folder>();
	private modseq = 1n;
	condstore = true;
	/** What the server prepends to a path it is asked to create or rename to. */
	namespacePrefix = "";
	onFetchBody: (uid: number) => Promise<void> = async () => {};

	folder(path: string, attributes: string[] = [], uidValidity = 7): Folder {
		const existing = this.folders.get(path);
		if (existing) return existing;
		const created: Folder = {
			uidValidity,
			uidNext: 1,
			attributes,
			subscribed: true,
			messages: new Map(),
		};
		this.folders.set(path, created);
		return created;
	}

	deliver(path: string, raw: Buffer, flags: string[] = []): number {
		const folder = this.folder(path);
		const uid = folder.uidNext++;
		folder.messages.set(uid, {
			raw,
			flags: new Set(flags),
			modseq: this.modseq++,
			internalDate: new Date(1_700_000_000_000 + uid * 1000),
		});
		return uid;
	}

	expunge(path: string, uid: number): void {
		this.folder(path).messages.delete(uid);
	}

	/** One STORE from another client: every message it touches shares the new mod-sequence. */
	store(path: string, uids: number[], flags: string[]): void {
		const modseq = this.modseq++;
		for (const uid of uids) {
			const message = this.folder(path).messages.get(uid);
			if (!message) throw new Error(`no uid ${uid} in ${path}`);
			message.flags = new Set(flags);
			message.modseq = modseq;
		}
	}

	renumber(path: string, uidValidity: number): void {
		const folder = this.folder(path);
		const messages = [...folder.messages.values()];
		folder.uidValidity = uidValidity;
		folder.messages = new Map(messages.map((message, i) => [i + 1, message]));
		folder.uidNext = messages.length + 1;
	}

	flagsOf(path: string, uid: number): string[] {
		return [...(this.folder(path).messages.get(uid)?.flags ?? [])].sort();
	}

	uids(path: string): number[] {
		return [...this.folder(path).messages.keys()];
	}

	highestModseq(): bigint {
		return this.modseq - 1n;
	}

	connect(): FakeImapConnection {
		return new FakeImapConnection(this);
	}

	bumpModseq(): bigint {
		return this.modseq++;
	}
}

export class FakeImapConnection implements IImapConnection {
	readonly state: ImapConnectionState = "authenticated";
	readonly isConnected = true;
	selected: string | null = null;
	readonly opened: string[] = [];

	constructor(private readonly server: FakeImapServer) {}

	private open(): Folder {
		if (!this.selected) throw new Error("No mailbox selected");
		const folder = this.server.folders.get(this.selected);
		if (!folder) throw new Error(`Mailbox ${this.selected} does not exist`);
		return folder;
	}

	connect = async (): Promise<void> => {};
	disconnect = async (): Promise<void> => {};

	getNamespaces = async (): Promise<ImapNamespaces> => ({
		personal: [{ prefix: "", delimiter: "/" }],
		other: [],
		shared: [],
	});

	listMailboxes = async (): Promise<FlatMailboxInfo[]> =>
		[...this.server.folders.entries()].map(([fullPath, folder]) => {
			const separator = fullPath.lastIndexOf("/");
			return {
				fullPath,
				name: separator === -1 ? fullPath : fullPath.slice(separator + 1),
				delimiter: "/",
				attributes: folder.attributes,
				parentPath: separator === -1 ? null : fullPath.slice(0, separator),
			};
		});

	openBox = async (path: string): Promise<ImapBoxStatus> => {
		const folder = this.server.folders.get(path);
		if (!folder) throw new Error(`Mailbox ${path} does not exist`);
		this.selected = path;
		this.opened.push(path);
		return {
			name: path,
			readOnly: false,
			uidvalidity: folder.uidValidity,
			uidnext: folder.uidNext,
			flags: [],
			permFlags: [],
			persistentUIDs: true,
			messages: { total: folder.messages.size, new: 0 },
			newKeywords: false,
		};
	};

	closeBox = async (): Promise<void> => {
		this.selected = null;
	};

	search = async (criteria: unknown[]): Promise<number[]> => {
		const folder = this.open();
		const all = [...folder.messages.keys()];
		const [first] = criteria;
		if (Array.isArray(first) && first[0] === "UID") {
			const wanted = String(first[1])
				.split(",")
				.map((uid) => Number(uid));
			return all.filter((uid) => wanted.includes(uid));
		}
		return all;
	};

	private toImapMessage = async (
		uid: number,
		stored: StoredMessage,
	): Promise<ImapMessage> => {
		const parsed = await simpleParser(stored.raw);
		const header = (name: string): string => {
			const value = parsed.headers.get(name);
			return typeof value === "string" ? value : "";
		};
		const contentType = single(parsed.headers.get("content-type")) as
			| { value: string; params?: Record<string, string> }
			| undefined;
		const bodyStructure: ImapBodyStructure = {
			type: contentType?.value ?? "text/plain",
			parameters: contentType?.params,
			encoding: "7bit",
			size: stored.raw.length,
		};
		const references = parsed.references;
		return {
			uid,
			seq: uid,
			flags: [...stored.flags],
			internalDate: stored.internalDate,
			size: stored.raw.length,
			envelope: {
				date: parsed.date?.toISOString() ?? "",
				subject: parsed.subject ?? "",
				from: toAddresses(single(parsed.from)),
				sender: toAddresses(single(parsed.from)),
				replyTo: toAddresses(single(parsed.replyTo)),
				to: toAddresses(single(parsed.to)),
				cc: toAddresses(single(parsed.cc)),
				bcc: [],
				inReplyTo: header("in-reply-to"),
				messageId: header("message-id"),
			},
			references:
				references === undefined
					? undefined
					: Array.isArray(references)
						? references
						: [references],
			bodyStructure,
			...(this.server.condstore ? { modseq: stored.modseq.toString() } : {}),
		};
	};

	fetchMessages = async (uids: number[]): Promise<ImapMessage[]> => {
		const folder = this.open();
		const rows: ImapMessage[] = [];
		for (const uid of uids) {
			const stored = folder.messages.get(uid);
			if (stored) rows.push(await this.toImapMessage(uid, stored));
		}
		return rows;
	};

	supportsCondstore = (): boolean => this.server.condstore;

	fetchMessagesChangedSince = async (
		sinceModseq: bigint,
	): Promise<ImapMessage[]> => {
		if (!this.server.condstore) {
			throw new Error("CHANGEDSINCE requires CONDSTORE");
		}
		const folder = this.open();
		const rows: ImapMessage[] = [];
		for (const [uid, stored] of folder.messages) {
			if (stored.modseq > sinceModseq) {
				rows.push(await this.toImapMessage(uid, stored));
			}
		}
		return rows;
	};

	fetchEnvelopeSnapshots = async (
		uids: number[],
	): Promise<ImapEnvelopeSnapshot[]> => {
		const rows = await this.fetchMessages(uids);
		return rows.map((row) => ({
			uid: row.uid,
			messageId: row.envelope?.messageId ?? "",
			internalDate: row.internalDate,
		}));
	};

	fetchMessageBody = async (uid: number): Promise<Buffer | null> => {
		await this.server.onFetchBody(uid);
		return this.open().messages.get(uid)?.raw ?? null;
	};

	async *fetchMessageBodies(
		uids: number[],
	): AsyncGenerator<{ uid: number; source: Readable }> {
		const folder = this.open();
		for (const uid of uids) {
			const stored = folder.messages.get(uid);
			if (stored) yield { uid, source: Readable.from([stored.raw]) };
		}
	}

	private touch = (uids: number[], change: (flags: Set<string>) => void) => {
		const folder = this.open();
		const modseq = this.server.bumpModseq();
		for (const uid of uids) {
			const stored = folder.messages.get(uid);
			if (!stored) continue;
			change(stored.flags);
			stored.modseq = modseq;
		}
	};

	addFlags = async (uids: number[], flags: string[]): Promise<void> =>
		this.touch(uids, (set) => {
			for (const flag of flags) set.add(flag);
		});

	removeFlags = async (uids: number[], flags: string[]): Promise<void> =>
		this.touch(uids, (set) => {
			for (const flag of flags) set.delete(flag);
		});

	setFlags = async (uids: number[], flags: string[]): Promise<void> =>
		this.touch(uids, (set) => {
			set.clear();
			for (const flag of flags) set.add(flag);
		});

	createMailbox = async (
		path: string,
	): Promise<{ path: string; created: boolean }> => {
		const resolved = this.server.namespacePrefix + path;
		const created = !this.server.folders.has(resolved);
		this.server.folder(resolved);
		return { path: resolved, created };
	};

	deleteMailbox = async (path: string): Promise<{ path: string }> => {
		if (!this.server.folders.delete(path)) {
			throw new Error(`Mailbox ${path} does not exist`);
		}
		return { path };
	};

	renameMailbox = async (
		oldPath: string,
		requested: string,
	): Promise<{ path: string; newPath: string }> => {
		if (!this.server.folders.has(oldPath)) {
			throw Object.assign(new Error("Command failed"), {
				serverResponseCode: "NONEXISTENT",
				responseText: `Mailbox doesn't exist: ${oldPath}`,
			});
		}
		const newPath = this.server.namespacePrefix + requested;
		for (const [path, folder] of [...this.server.folders]) {
			if (path !== oldPath && !path.startsWith(`${oldPath}/`)) continue;
			this.server.folders.delete(path);
			this.server.folders.set(newPath + path.slice(oldPath.length), folder);
		}
		return { path: oldPath, newPath };
	};

	subscribeMailbox = async (path: string): Promise<void> => {
		this.server.folder(path).subscribed = true;
	};

	unsubscribeMailbox = async (path: string): Promise<void> => {
		this.server.folder(path).subscribed = false;
	};

	private transfer = (
		uids: number[],
		destination: string,
		removeFromSource: boolean,
	) => {
		const source = this.open();
		const target = this.server.folders.get(destination);
		if (!target) throw new Error(`Mailbox ${destination} does not exist`);
		const uidMap = new Map<number, number>();
		for (const uid of uids) {
			const stored = source.messages.get(uid);
			if (!stored) continue;
			const next = target.uidNext++;
			target.messages.set(next, {
				...stored,
				flags: new Set(stored.flags),
				modseq: this.server.bumpModseq(),
			});
			if (removeFromSource) source.messages.delete(uid);
			uidMap.set(uid, next);
		}
		return { destination, uidValidity: target.uidValidity, uidMap };
	};

	moveMessages = async (uids: number[], destination: string) =>
		this.transfer(uids, destination, true);

	copyMessages = async (uids: number[], destination: string) =>
		this.transfer(uids, destination, false);

	deleteMessages = async (uids: number[]): Promise<number> => {
		const folder = this.open();
		let deleted = 0;
		for (const uid of uids) {
			if (folder.messages.delete(uid)) deleted++;
		}
		return deleted;
	};

	getMailboxStatus = async (path: string): Promise<ImapMailboxStatus> => {
		const folder = this.server.folders.get(path);
		if (!folder) throw new Error(`Mailbox ${path} does not exist`);
		const messages = [...folder.messages.values()];
		return {
			messages: messages.length,
			recent: 0,
			unseen: messages.filter((message) => !message.flags.has("\\Seen")).length,
			uidNext: folder.uidNext,
			uidValidity: folder.uidValidity,
			highestModseq: this.server.condstore
				? this.server.highestModseq().toString()
				: "0",
			deletedCount: messages.filter((message) => message.flags.has("\\Deleted"))
				.length,
		};
	};

	append = async (
		mailbox: string,
		message: string | Buffer,
		flags: string[] = [],
	): Promise<{ destination: string; uidValidity: number; uid: number }> => {
		const uid = this.server.deliver(
			mailbox,
			Buffer.isBuffer(message) ? message : Buffer.from(message),
			flags,
		);
		return {
			destination: mailbox,
			uidValidity: this.server.folder(mailbox).uidValidity,
			uid,
		};
	};
}
