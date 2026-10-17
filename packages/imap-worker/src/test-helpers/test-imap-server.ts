import { Readable } from "node:stream";
import type {
	FlatMailboxInfo,
	IImapConnection,
	ImapBoxStatus,
	ImapMessage,
} from "@remit/mailbox-service/types";

/**
 * A mail server held in memory, reached through the IMAP port the handlers
 * talk to. It keeps folders, their UIDVALIDITY and the messages each holds, so
 * a test arranges what the server holds and asserts what it holds afterwards.
 * `log` records every command that would reach the wire.
 */

export interface StoredMessage {
	uid: number;
	messageIdHeader?: string;
	flags: Set<string>;
	raw: Buffer;
}

export interface Folder {
	uidValidity: number;
	uidNext: number;
	messages: StoredMessage[];
	subscribed: boolean;
}

type Verb =
	| "SELECT"
	| "EXAMINE"
	| "SEARCH"
	| "FETCH"
	| "BODY"
	| "MOVE"
	| "COPY"
	| "EXPUNGE"
	| "CREATE"
	| "RENAME"
	| "DELETE"
	| "SUBSCRIBE"
	| "APPEND"
	| "STORE";

export type Failure = Partial<Record<Verb, Error>>;

/** An error shaped the way ImapFlow reports a tagged NO from the server. */
export const imapError = (code: string, text: string): Error =>
	Object.assign(new Error(`Command failed: ${text}`), {
		serverResponseCode: code,
		responseText: text,
	});

const messageIdOf = (raw: Buffer): string | undefined =>
	/^Message-ID:\s*(.+?)\s*$/im.exec(raw.toString("utf8"))?.[1];

export class FakeImapServer {
	readonly folders = new Map<string, Folder>();
	readonly log: string[] = [];
	/** Failures the next command of a verb answers with, consumed once. */
	readonly failNext: Failure = {};
	/** RFC 4315. Without it a MOVE or COPY answers with no COPYUID. */
	uidplus = true;
	/** Verbs whose next command the server answers OK and then does nothing. */
	readonly ignoreNext = new Set<Verb>();
	connections = 0;

	addFolder(path: string, uidValidity = 1): Folder {
		const folder: Folder = {
			uidValidity,
			uidNext: 1,
			messages: [],
			subscribed: true,
		};
		this.folders.set(path, folder);
		return folder;
	}

	deliver(path: string, messageIdHeader?: string, uid?: number): number {
		const folder = this.folder(path);
		const assigned = uid ?? folder.uidNext;
		folder.uidNext = Math.max(folder.uidNext, assigned + 1);
		folder.messages.push({
			uid: assigned,
			messageIdHeader,
			flags: new Set(),
			raw: Buffer.from(
				`Message-ID: ${messageIdHeader ?? ""}\r\nSubject: test\r\n\r\nbody`,
			),
		});
		return assigned;
	}

	uids(path: string, messageIdHeader?: string): number[] {
		return this.folder(path)
			.messages.filter(
				(message) =>
					messageIdHeader === undefined ||
					message.messageIdHeader === messageIdHeader,
			)
			.map((message) => message.uid);
	}

	commands(verb: Verb): string[] {
		return this.log.filter((line) => line.startsWith(`${verb} `));
	}

	folder(path: string): Folder {
		const folder = this.folders.get(path);
		if (!folder)
			throw imapError("NONEXISTENT", `Mailbox doesn't exist: ${path}`);
		return folder;
	}

	private run(verb: Verb, detail: string): void {
		this.log.push(`${verb} ${detail}`);
		const failure = this.failNext[verb];
		if (failure) {
			delete this.failNext[verb];
			throw failure;
		}
	}

	connection(): IImapConnection {
		this.connections += 1;
		let selected: string | undefined;
		const server = this;
		const box = (): Folder => {
			if (selected === undefined) throw new Error("No mailbox selected");
			return server.folder(selected);
		};
		const transfer = (
			verb: "MOVE" | "COPY",
			uids: number[],
			destination: string,
		) => {
			server.run(verb, `${selected} ${uids.join(",")} ${destination}`);
			const target = server.folders.get(destination);
			if (!target)
				throw new Error("Command failed: [TRYCREATE] no such mailbox");
			if (server.ignoreNext.delete(verb)) {
				return {
					destination,
					uidValidity: target.uidValidity,
					uidMap: new Map(),
				};
			}
			const source = box();
			const uidMap = new Map<number, number>();
			for (const uid of uids) {
				const message = source.messages.find((m) => m.uid === uid);
				if (!message) continue;
				const newUid = target.uidNext;
				target.uidNext += 1;
				target.messages.push({
					...message,
					uid: newUid,
					flags: new Set(message.flags),
				});
				if (verb === "MOVE") {
					source.messages = source.messages.filter((m) => m.uid !== uid);
				}
				if (server.uidplus) uidMap.set(uid, newUid);
			}
			return { destination, uidValidity: target.uidValidity, uidMap };
		};
		const toImapMessage = (
			message: StoredMessage,
			seq: number,
		): ImapMessage => ({
			uid: message.uid,
			seq,
			flags: [...message.flags],
			internalDate: new Date(0),
			size: message.raw.length,
			envelope: { messageId: message.messageIdHeader } as never,
		});
		const store = (uids: number[], apply: (flags: Set<string>) => void) => {
			for (const message of box().messages) {
				if (uids.includes(message.uid)) apply(message.flags);
			}
		};

		const connection: IImapConnection = {
			state: "connected" as never,
			isConnected: true,
			connect: async () => {},
			disconnect: async () => {},
			getNamespaces: async () =>
				({ personal: [{ prefix: "", delimiter: "/" }] }) as never,
			listMailboxes: async (): Promise<FlatMailboxInfo[]> =>
				[...server.folders.keys()].map((fullPath) => ({
					fullPath,
					name: fullPath.split("/").at(-1) ?? fullPath,
					delimiter: "/",
					attributes: [],
					parentPath: fullPath.includes("/")
						? fullPath.slice(0, fullPath.lastIndexOf("/"))
						: null,
				})),
			openBox: async (
				path: string,
				readOnly = false,
			): Promise<ImapBoxStatus> => {
				server.run(readOnly ? "EXAMINE" : "SELECT", path);
				const folder = server.folder(path);
				selected = path;
				return {
					name: path,
					readOnly,
					uidvalidity: folder.uidValidity,
					uidnext: folder.uidNext,
					flags: [],
					permFlags: [],
					persistentUIDs: true,
					messages: { total: folder.messages.length, new: 0 },
					newKeywords: false,
				};
			},
			closeBox: async () => {
				selected = undefined;
			},
			search: async (criteria: unknown[]) => {
				server.run("SEARCH", `${selected} ${JSON.stringify(criteria)}`);
				const [first] = criteria;
				const messages = box().messages;
				if (Array.isArray(first) && first[0] === "UID") {
					const uid = Number(first[1]);
					return messages.filter((m) => m.uid === uid).map((m) => m.uid);
				}
				if (
					Array.isArray(first) &&
					String(first[0]).toUpperCase() === "HEADER"
				) {
					return messages
						.filter((m) => m.messageIdHeader === first[2])
						.map((m) => m.uid);
				}
				return messages.map((m) => m.uid);
			},
			fetchMessages: async (uids: number[]) => {
				server.run("FETCH", `${selected} ${uids.join(",")}`);
				return box()
					.messages.filter((m) => uids.includes(m.uid))
					.map(toImapMessage);
			},
			supportsCondstore: () => false,
			fetchMessagesChangedSince: async () => [],
			fetchEnvelopeSnapshots: async (uids: number[]) =>
				box()
					.messages.filter((m) => uids.includes(m.uid))
					.map((m) => ({ uid: m.uid, messageId: m.messageIdHeader })) as never,
			fetchMessageBody: async (uid: number) => {
				server.run("BODY", `${selected} ${uid}`);
				return box().messages.find((m) => m.uid === uid)?.raw ?? null;
			},
			fetchMessageBodies: async function* (uids: number[]) {
				server.run("BODY", `${selected} ${uids.join(",")}`);
				for (const message of box().messages) {
					if (uids.includes(message.uid)) {
						yield { uid: message.uid, source: Readable.from([message.raw]) };
					}
				}
			},
			addFlags: async (uids: number[], flags: string[]) => {
				server.run(
					"STORE",
					`${selected} ${uids.join(",")} +${flags.join(" ")}`,
				);
				store(uids, (set) => {
					for (const flag of flags) set.add(flag);
				});
			},
			removeFlags: async (uids: number[], flags: string[]) => {
				server.run(
					"STORE",
					`${selected} ${uids.join(",")} -${flags.join(" ")}`,
				);
				store(uids, (set) => {
					for (const flag of flags) set.delete(flag);
				});
			},
			setFlags: async (uids: number[], flags: string[]) => {
				server.run("STORE", `${selected} ${uids.join(",")} ${flags.join(" ")}`);
				store(uids, (set) => {
					set.clear();
					for (const flag of flags) set.add(flag);
				});
			},
			createMailbox: async (path: string) => {
				server.run("CREATE", path);
				if (server.folders.has(path)) return { path, created: false };
				server.addFolder(path, Date.now() % 1_000_000);
				return { path, created: true };
			},
			deleteMailbox: async (path: string) => {
				server.run("DELETE", path);
				if (path === "INBOX") throw imapError("CANNOT", "Cannot delete INBOX");
				server.folder(path);
				for (const key of [...server.folders.keys()]) {
					if (key === path || key.startsWith(`${path}/`))
						server.folders.delete(key);
				}
				return { path };
			},
			renameMailbox: async (oldPath: string, newPath: string) => {
				server.run("RENAME", `${oldPath} ${newPath}`);
				server.folder(oldPath);
				if (server.folders.has(newPath)) {
					throw imapError(
						"ALREADYEXISTS",
						`Mailbox already exists: ${newPath}`,
					);
				}
				for (const key of [...server.folders.keys()]) {
					if (key === oldPath || key.startsWith(`${oldPath}/`)) {
						const folder = server.folders.get(key) as Folder;
						server.folders.delete(key);
						server.folders.set(newPath + key.slice(oldPath.length), folder);
					}
				}
				return { path: oldPath, newPath };
			},
			subscribeMailbox: async (path: string) => {
				server.run("SUBSCRIBE", path);
				server.folder(path).subscribed = true;
			},
			unsubscribeMailbox: async (path: string) => {
				server.folder(path).subscribed = false;
			},
			moveMessages: async (uids: number[], destination: string) =>
				transfer("MOVE", uids, destination),
			copyMessages: async (uids: number[], destination: string) =>
				transfer("COPY", uids, destination),
			deleteMessages: async (uids: number[]) => {
				server.run("EXPUNGE", `${selected} ${uids.join(",")}`);
				const folder = box();
				const before = folder.messages.length;
				folder.messages = folder.messages.filter((m) => !uids.includes(m.uid));
				return before - folder.messages.length;
			},
			getMailboxStatus: async (path: string) => {
				const folder = server.folder(path);
				return {
					messages: folder.messages.length,
					recent: 0,
					uidNext: folder.uidNext,
					uidValidity: folder.uidValidity,
					unseen: folder.messages.filter((m) => !m.flags.has("\\Seen")).length,
				} as never;
			},
			append: async (
				path: string,
				message: string | Buffer,
				flags: string[] = [],
			) => {
				server.run("APPEND", path);
				const folder = server.folder(path);
				const raw = Buffer.isBuffer(message) ? message : Buffer.from(message);
				const uid = folder.uidNext;
				folder.uidNext += 1;
				folder.messages.push({
					uid,
					messageIdHeader: messageIdOf(raw),
					flags: new Set(flags),
					raw,
				});
				return { destination: path, uidValidity: folder.uidValidity, uid };
			},
		};
		return connection;
	}
}
