import { Readable } from "node:stream";
import type {
	FlatMailboxInfo,
	IImapConnection,
	ImapBoxStatus,
	ImapEnvelope,
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
	internalDate: Date;
}

export interface Folder {
	uidValidity: number;
	uidNext: number;
	messages: StoredMessage[];
	subscribed: boolean;
}

type Verb =
	| "NAMESPACE"
	| "LIST"
	| "STATUS"
	| "SELECT"
	| "EXAMINE"
	| "CLOSE"
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
	| "UNSUBSCRIBE"
	| "APPEND"
	| "STORE";

export type Failure = Partial<Record<Verb, Error>>;

/** An error shaped the way ImapFlow reports a tagged NO from the server. */
export const imapError = (code: string, text: string): Error =>
	Object.assign(new Error(`Command failed: ${text}`), {
		serverResponseCode: code,
		responseText: text,
	});

const header = (raw: Buffer, name: string): string | undefined =>
	new RegExp(`^${name}:\\s*(.+?)\\s*$`, "im").exec(raw.toString("utf8"))?.[1];

const address = (value: string | undefined) => {
	const match = /<?([^<>\s@]+)@([^<>\s]+?)>?$/.exec(value ?? "");
	return match ? [{ mailbox: match[1] ?? "", host: match[2] ?? "" }] : [];
};

const envelopeOf = (message: StoredMessage): ImapEnvelope => {
	const from = address(header(message.raw, "From"));
	return {
		date: header(message.raw, "Date") ?? message.internalDate.toUTCString(),
		subject: header(message.raw, "Subject") ?? "",
		from,
		sender: from,
		replyTo: from,
		to: address(header(message.raw, "To")),
		cc: [],
		bcc: [],
		inReplyTo: header(message.raw, "In-Reply-To") ?? "",
		messageId: message.messageIdHeader ?? "",
	};
};

export class FakeImapServer {
	readonly folders = new Map<string, Folder>();
	readonly log: string[] = [];
	readonly failNext: Failure = {};
	uidplus = true;
	readonly ignoreNext = new Set<Verb>();
	connections = 0;
	private nextUidValidity = 1000;

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
			internalDate: new Date(1_700_000_000_000),
			raw: Buffer.from(
				[
					`Message-ID: ${messageIdHeader ?? ""}`,
					"From: Friend <friend@example.com>",
					"To: Person <person@example.com>",
					"Date: Tue, 14 Nov 2023 22:13:20 +0000",
					"Subject: test",
					"Content-Type: text/plain; charset=utf-8",
					"",
					"body",
				].join("\r\n"),
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
		if (!folder) {
			throw imapError("NONEXISTENT", `Mailbox doesn't exist: ${path}`);
		}
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
			if (!target) {
				throw new Error("Command failed: [TRYCREATE] no such mailbox");
			}
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
			index: number,
		): ImapMessage => ({
			uid: message.uid,
			seq: index + 1,
			flags: [...message.flags],
			internalDate: message.internalDate,
			size: message.raw.length,
			envelope: envelopeOf(message),
			bodyStructure: {
				type: "text/plain",
				parameters: { charset: "utf-8" },
				encoding: "7bit",
				size: message.raw.length,
			},
		});
		const store = (uids: number[], apply: (flags: Set<string>) => void) => {
			for (const message of box().messages) {
				if (uids.includes(message.uid)) apply(message.flags);
			}
		};
		const selectedMessages = (uids: number[]) =>
			box().messages.filter((m) => uids.includes(m.uid));

		return {
			state: "connected" as never,
			isConnected: true,
			connect: async () => {},
			disconnect: async () => {},
			getNamespaces: async () => {
				server.run("NAMESPACE", "");
				return { personal: [{ prefix: "", delimiter: "/" }] } as never;
			},
			listMailboxes: async (): Promise<FlatMailboxInfo[]> => {
				server.run("LIST", "");
				return [...server.folders.keys()].map((fullPath) => ({
					fullPath,
					name: fullPath.split("/").at(-1) ?? fullPath,
					delimiter: "/",
					attributes: [],
					parentPath: fullPath.includes("/")
						? fullPath.slice(0, fullPath.lastIndexOf("/"))
						: null,
				}));
			},
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
				server.run("CLOSE", `${selected}`);
				selected = undefined;
			},
			search: async (criteria: unknown[]) => {
				server.run("SEARCH", `${selected} ${JSON.stringify(criteria)}`);
				const messages = box().messages;
				const [first] = criteria;
				if (criteria.length === 1 && first === "ALL") {
					return messages.map((m) => m.uid);
				}
				if (Array.isArray(first) && first[0] === "UID") {
					const uid = Number(first[1]);
					return messages.filter((m) => m.uid === uid).map((m) => m.uid);
				}
				if (
					Array.isArray(first) &&
					first[0] === "HEADER" &&
					String(first[1]).toLowerCase() === "message-id"
				) {
					return messages
						.filter((m) => m.messageIdHeader === first[2])
						.map((m) => m.uid);
				}
				throw new Error(
					`the fake server does not answer SEARCH ${JSON.stringify(criteria)}`,
				);
			},
			fetchMessages: async (uids: number[]) => {
				server.run("FETCH", `${selected} ${uids.join(",")}`);
				return selectedMessages(uids).map(toImapMessage);
			},
			supportsCondstore: () => false,
			fetchMessagesChangedSince: async () => {
				throw new Error("the fake server has no CONDSTORE");
			},
			fetchEnvelopeSnapshots: async (uids: number[]) => {
				server.run("FETCH", `${selected} ${uids.join(",")} ENVELOPE`);
				return selectedMessages(uids).map((m) => ({
					uid: m.uid,
					messageId: m.messageIdHeader ?? "",
					internalDate: m.internalDate,
				}));
			},
			fetchMessageBody: async (uid: number) => {
				server.run("BODY", `${selected} ${uid}`);
				return box().messages.find((m) => m.uid === uid)?.raw ?? null;
			},
			fetchMessageBodies: async function* (uids: number[]) {
				server.run("BODY", `${selected} ${uids.join(",")}`);
				for (const message of selectedMessages(uids)) {
					yield { uid: message.uid, source: Readable.from([message.raw]) };
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
				server.nextUidValidity += 1;
				server.addFolder(path, server.nextUidValidity);
				return { path, created: true };
			},
			deleteMailbox: async (path: string) => {
				server.run("DELETE", path);
				if (path === "INBOX") {
					throw imapError("CANNOT", "Cannot delete INBOX");
				}
				server.folder(path);
				for (const key of [...server.folders.keys()]) {
					if (key === path || key.startsWith(`${path}/`)) {
						server.folders.delete(key);
					}
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
				server.run("UNSUBSCRIBE", path);
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
				server.run("STATUS", path);
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
					messageIdHeader: header(raw, "Message-ID"),
					flags: new Set(flags),
					raw,
					internalDate: new Date(),
				});
				return { destination: path, uidValidity: folder.uidValidity, uid };
			},
		};
	}
}
