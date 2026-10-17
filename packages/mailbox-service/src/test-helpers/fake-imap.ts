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

export type FakeImapVerb =
	| "NAMESPACE"
	| "LIST"
	| "STATUS"
	| "SELECT"
	| "EXAMINE"
	| "CLOSE"
	| "SEARCH"
	| "FETCH"
	| "BODY"
	| "STORE"
	| "MOVE"
	| "COPY"
	| "EXPUNGE"
	| "CREATE"
	| "RENAME"
	| "DELETE"
	| "SUBSCRIBE"
	| "UNSUBSCRIBE"
	| "APPEND";

/** An error shaped the way ImapFlow reports a tagged NO from the server. */
export const imapError = (code: string, text: string): Error =>
	Object.assign(new Error(`Command failed: [${code}] ${text}`), {
		serverResponseCode: code,
		responseText: text,
	});

const nonexistent = (path: string): Error =>
	imapError("NONEXISTENT", `Mailbox doesn't exist: ${path}`);

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

const messageIdOf = (raw: Buffer): string =>
	/^Message-ID:\s*(.+?)\s*$/im.exec(raw.toString("utf8"))?.[1] ?? "";

const UID_RANGE = /^(\d+)(?::(\d+|\*))?$/;

/** Whether `uid` is in an IMAP sequence set such as `3`, `1,4` or `2:*`. */
const inUidSet = (set: string, uid: number, highest: number): boolean =>
	set.split(",").some((part) => {
		const match = UID_RANGE.exec(part);
		if (!match) throw new Error(`the fake server cannot read UID set ${set}`);
		const from = Number(match[1]);
		const to =
			match[2] === undefined
				? from
				: match[2] === "*"
					? Math.max(highest, from)
					: Number(match[2]);
		return uid >= Math.min(from, to) && uid <= Math.max(from, to);
	});

/**
 * An IMAP server held in memory, behind the same connection port the imapflow
 * adapter implements. It refuses what a server refuses: a folder that does not
 * exist is `NONEXISTENT`, a transfer or APPEND to one is `TRYCREATE`, and a
 * SEARCH it does not model throws rather than matching everything. FETCH rows
 * are derived from the raw bytes the way the adapter derives them. `log`
 * records every command that would reach the wire.
 */
export class FakeImapServer {
	private readonly folders = new Map<string, Folder>();
	private modseq = 1n;
	private nextUidValidity = 1000;
	readonly log: string[] = [];
	readonly failNext: Partial<Record<FakeImapVerb, Error>> = {};
	readonly ignoreNext = new Set<FakeImapVerb>();
	condstore = true;
	uidplus = true;
	namespacePrefix = "";
	connections = 0;
	onFetchBody: (uid: number) => Promise<void> = async () => {};

	addFolder(
		path: string,
		options: { attributes?: string[]; uidValidity?: number } = {},
	): void {
		if (this.folders.has(path)) throw new Error(`${path} already exists`);
		this.folders.set(path, {
			uidValidity: options.uidValidity ?? 7,
			uidNext: 1,
			attributes: options.attributes ?? [],
			subscribed: true,
			messages: new Map(),
		});
	}

	hasFolder(path: string): boolean {
		return this.folders.has(path);
	}

	/** Another client deleted the folder. */
	removeFolder(path: string): void {
		if (!this.folders.delete(path)) throw nonexistent(path);
	}

	isSubscribed(path: string): boolean {
		return this.folder(path).subscribed;
	}

	folder(path: string): Folder {
		const folder = this.folders.get(path);
		if (!folder) throw nonexistent(path);
		return folder;
	}

	paths(): string[] {
		return [...this.folders.keys()];
	}

	deliver(
		path: string,
		raw: Buffer,
		options: { flags?: string[]; uid?: number } = {},
	): number {
		const folder = this.folder(path);
		const uid = options.uid ?? folder.uidNext;
		if (folder.messages.has(uid))
			throw new Error(`uid ${uid} is taken in ${path}`);
		folder.uidNext = Math.max(folder.uidNext, uid + 1);
		folder.messages.set(uid, {
			raw,
			flags: new Set(options.flags ?? []),
			modseq: this.modseq++,
			internalDate: new Date(1_700_000_000_000 + uid * 1000),
		});
		return uid;
	}

	/** Another client expunged the message. */
	expunge(path: string, uid: number): void {
		if (!this.folder(path).messages.delete(uid)) {
			throw new Error(`no uid ${uid} in ${path}`);
		}
	}

	/** Another client expunged everything in the folder. */
	empty(path: string): void {
		this.folder(path).messages.clear();
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

	/** The server renumbered the folder: a new UIDVALIDITY, UIDs from 1. */
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

	uids(path: string, messageIdHeader?: string): number[] {
		return [...this.folder(path).messages]
			.filter(
				([, message]) =>
					messageIdHeader === undefined ||
					messageIdOf(message.raw) === messageIdHeader,
			)
			.map(([uid]) => uid);
	}

	/** What the server holds in a folder, as another client would read it. */
	messages(path: string): Array<{
		uid: number;
		messageIdHeader: string;
		flags: string[];
		raw: Buffer;
	}> {
		return [...this.folder(path).messages].map(([uid, message]) => ({
			uid,
			messageIdHeader: messageIdOf(message.raw),
			flags: [...message.flags].sort(),
			raw: message.raw,
		}));
	}

	/** The server changed UIDVALIDITY without renumbering what it serves. */
	setUidValidity(path: string, uidValidity: number): void {
		this.folder(path).uidValidity = uidValidity;
	}

	uidValidityOf(path: string): number {
		return this.folder(path).uidValidity;
	}

	highestModseq(): bigint {
		return this.modseq - 1n;
	}

	bumpModseq(): bigint {
		return this.modseq++;
	}

	commands(verb: FakeImapVerb): string[] {
		return this.log.filter((line) => line.startsWith(`${verb} `));
	}

	run(verb: FakeImapVerb, detail: string): void {
		this.log.push(`${verb} ${detail}`);
		const failure = this.failNext[verb];
		if (failure) {
			delete this.failNext[verb];
			throw failure;
		}
	}

	createFolder(path: string): boolean {
		if (this.folders.has(path)) return false;
		this.nextUidValidity += 1;
		this.addFolder(path, { uidValidity: this.nextUidValidity });
		return true;
	}

	renameFolder(oldPath: string, newPath: string): void {
		this.folder(oldPath);
		if (this.folders.has(newPath)) {
			throw imapError("ALREADYEXISTS", `Mailbox already exists: ${newPath}`);
		}
		for (const [path, folder] of [...this.folders]) {
			if (path !== oldPath && !path.startsWith(`${oldPath}/`)) continue;
			this.folders.delete(path);
			this.folders.set(newPath + path.slice(oldPath.length), folder);
		}
	}

	deleteFolder(path: string): void {
		if (path === "INBOX") throw imapError("CANNOT", "Cannot delete INBOX");
		this.folder(path);
		for (const key of [...this.folders.keys()]) {
			if (key === path || key.startsWith(`${path}/`)) this.folders.delete(key);
		}
	}

	connection(): FakeImapConnection {
		this.connections += 1;
		return new FakeImapConnection(this);
	}
}

export class FakeImapConnection implements IImapConnection {
	readonly state: ImapConnectionState = "authenticated";
	readonly isConnected = true;
	private selected: string | null = null;

	constructor(private readonly server: FakeImapServer) {}

	private open(): Folder {
		if (this.selected === null) throw new Error("No mailbox selected");
		return this.server.folder(this.selected);
	}

	private uidList = (uids: number[]): string => uids.join(",");

	connect = async (): Promise<void> => {};
	disconnect = async (): Promise<void> => {};

	getNamespaces = async (): Promise<ImapNamespaces> => {
		this.server.run("NAMESPACE", "");
		return {
			personal: [{ prefix: this.server.namespacePrefix, delimiter: "/" }],
			other: [],
			shared: [],
		};
	};

	listMailboxes = async (): Promise<FlatMailboxInfo[]> => {
		this.server.run("LIST", "");
		return this.server.paths().map((fullPath) => {
			const separator = fullPath.lastIndexOf("/");
			return {
				fullPath,
				name: separator === -1 ? fullPath : fullPath.slice(separator + 1),
				delimiter: "/",
				attributes: this.server.folder(fullPath).attributes,
				parentPath: separator === -1 ? null : fullPath.slice(0, separator),
			};
		});
	};

	openBox = async (path: string, readOnly = false): Promise<ImapBoxStatus> => {
		this.server.run(readOnly ? "EXAMINE" : "SELECT", path);
		const folder = this.server.folder(path);
		this.selected = path;
		return {
			name: path,
			readOnly,
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
		this.server.run("CLOSE", `${this.selected}`);
		this.selected = null;
	};

	search = async (criteria: unknown[]): Promise<number[]> => {
		this.server.run("SEARCH", `${this.selected} ${JSON.stringify(criteria)}`);
		const folder = this.open();
		const all = [...folder.messages.keys()];
		const [first] = criteria;
		if (criteria.length === 1 && first === "ALL") return all;
		if (
			criteria.length === 1 &&
			Array.isArray(first) &&
			first.length === 2 &&
			first[0] === "UID"
		) {
			const highest = Math.max(0, ...all);
			return all.filter((uid) => inUidSet(String(first[1]), uid, highest));
		}
		if (
			criteria.length === 1 &&
			Array.isArray(first) &&
			first.length === 3 &&
			first[0] === "HEADER" &&
			String(first[1]).toLowerCase() === "message-id"
		) {
			return all.filter(
				(uid) =>
					messageIdOf(folder.messages.get(uid)?.raw ?? Buffer.alloc(0)) ===
					first[2],
			);
		}
		throw new Error(
			`the fake server does not answer SEARCH ${JSON.stringify(criteria)}`,
		);
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
			encoding: header("content-transfer-encoding") || "7bit",
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

	private fetchRows = async (uids: number[]): Promise<ImapMessage[]> => {
		const folder = this.open();
		const rows: ImapMessage[] = [];
		for (const uid of uids) {
			const stored = folder.messages.get(uid);
			if (stored) rows.push(await this.toImapMessage(uid, stored));
		}
		return rows;
	};

	fetchMessages = async (uids: number[]): Promise<ImapMessage[]> => {
		this.server.run("FETCH", `${this.selected} ${this.uidList(uids)}`);
		return this.fetchRows(uids);
	};

	supportsCondstore = (): boolean => this.server.condstore;

	fetchMessagesChangedSince = async (
		sinceModseq: bigint,
	): Promise<ImapMessage[]> => {
		this.server.run(
			"FETCH",
			`${this.selected} 1:* CHANGEDSINCE ${sinceModseq}`,
		);
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
		this.server.run("FETCH", `${this.selected} ${this.uidList(uids)} ENVELOPE`);
		const rows = await this.fetchRows(uids);
		return rows.map((row) => ({
			uid: row.uid,
			messageId: row.envelope?.messageId ?? "",
			internalDate: row.internalDate,
		}));
	};

	fetchMessageBody = async (uid: number): Promise<Buffer | null> => {
		this.server.run("BODY", `${this.selected} ${uid}`);
		await this.server.onFetchBody(uid);
		return this.open().messages.get(uid)?.raw ?? null;
	};

	async *fetchMessageBodies(
		uids: number[],
	): AsyncGenerator<{ uid: number; source: Readable }> {
		this.server.run("BODY", `${this.selected} ${this.uidList(uids)}`);
		const folder = this.open();
		for (const uid of uids) {
			const stored = folder.messages.get(uid);
			if (stored) yield { uid, source: Readable.from([stored.raw]) };
		}
	}

	private touch = (
		detail: string,
		uids: number[],
		change: (flags: Set<string>) => void,
	) => {
		this.server.run(
			"STORE",
			`${this.selected} ${this.uidList(uids)} ${detail}`,
		);
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
		this.touch(`+${flags.join(" ")}`, uids, (set) => {
			for (const flag of flags) set.add(flag);
		});

	removeFlags = async (uids: number[], flags: string[]): Promise<void> =>
		this.touch(`-${flags.join(" ")}`, uids, (set) => {
			for (const flag of flags) set.delete(flag);
		});

	setFlags = async (uids: number[], flags: string[]): Promise<void> =>
		this.touch(flags.join(" "), uids, (set) => {
			set.clear();
			for (const flag of flags) set.add(flag);
		});

	createMailbox = async (
		path: string,
	): Promise<{ path: string; created: boolean }> => {
		const resolved = this.server.namespacePrefix + path;
		this.server.run("CREATE", resolved);
		return { path: resolved, created: this.server.createFolder(resolved) };
	};

	deleteMailbox = async (path: string): Promise<{ path: string }> => {
		this.server.run("DELETE", path);
		this.server.deleteFolder(path);
		return { path };
	};

	renameMailbox = async (
		oldPath: string,
		requested: string,
	): Promise<{ path: string; newPath: string }> => {
		const newPath = this.server.namespacePrefix + requested;
		this.server.run("RENAME", `${oldPath} ${newPath}`);
		this.server.renameFolder(oldPath, newPath);
		return { path: oldPath, newPath };
	};

	subscribeMailbox = async (path: string): Promise<void> => {
		this.server.run("SUBSCRIBE", path);
		this.server.folder(path).subscribed = true;
	};

	unsubscribeMailbox = async (path: string): Promise<void> => {
		this.server.run("UNSUBSCRIBE", path);
		this.server.folder(path).subscribed = false;
	};

	private transfer = (
		verb: "MOVE" | "COPY",
		uids: number[],
		destination: string,
	) => {
		this.server.run(
			verb,
			`${this.selected} ${this.uidList(uids)} ${destination}`,
		);
		if (!this.server.hasFolder(destination)) {
			throw imapError("TRYCREATE", `Mailbox doesn't exist: ${destination}`);
		}
		const target = this.server.folder(destination);
		const uidMap = new Map<number, number>();
		if (this.server.ignoreNext.delete(verb)) {
			return { destination, uidValidity: target.uidValidity, uidMap };
		}
		const source = this.open();
		for (const uid of uids) {
			const stored = source.messages.get(uid);
			if (!stored) continue;
			const next = target.uidNext++;
			target.messages.set(next, {
				...stored,
				flags: new Set(stored.flags),
				modseq: this.server.bumpModseq(),
			});
			if (verb === "MOVE") source.messages.delete(uid);
			if (this.server.uidplus) uidMap.set(uid, next);
		}
		return { destination, uidValidity: target.uidValidity, uidMap };
	};

	moveMessages = async (uids: number[], destination: string) =>
		this.transfer("MOVE", uids, destination);

	copyMessages = async (uids: number[], destination: string) =>
		this.transfer("COPY", uids, destination);

	deleteMessages = async (uids: number[]): Promise<number> => {
		this.server.run("EXPUNGE", `${this.selected} ${this.uidList(uids)}`);
		const folder = this.open();
		let deleted = 0;
		for (const uid of uids) {
			if (folder.messages.delete(uid)) deleted++;
		}
		return deleted;
	};

	getMailboxStatus = async (path: string): Promise<ImapMailboxStatus> => {
		this.server.run("STATUS", path);
		const folder = this.server.folder(path);
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
		this.server.run("APPEND", mailbox);
		if (!this.server.hasFolder(mailbox)) {
			throw imapError("TRYCREATE", `Mailbox doesn't exist: ${mailbox}`);
		}
		const uid = this.server.deliver(
			mailbox,
			Buffer.isBuffer(message) ? message : Buffer.from(message),
			{ flags },
		);
		return {
			destination: mailbox,
			uidValidity: this.server.folder(mailbox).uidValidity,
			uid,
		};
	};
}
