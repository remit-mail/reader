import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Logger } from "@remit/logger-lambda";
import type { MessageCopyEvent } from "../events.js";
import { handleMessageCopy, type MessageCopyDeps } from "./message-copy.js";

const noopLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLog,
} as unknown as Logger;

interface Call {
	method: string;
	args: unknown[];
}

interface Connection {
	openBox: (
		path: string,
		readOnly?: boolean,
	) => Promise<{ uidvalidity: number }>;
	copyMessages: (
		uids: number[],
		dest: string,
	) => Promise<{ uidMap: Map<number, number> }>;
	createMailbox: (path: string) => Promise<void>;
}

interface Harness {
	calls: Call[];
	account: {
		accountId: string;
		accountConfigId: string;
		deletedAt?: number;
	} | null;
	mailbox: { mailboxId: string; uidValidity: number; cursorState?: string };
	connection: Connection;
	getConnectionCount: number;
	disconnectCount: number;
}

let h: Harness;

const record =
	(method: string) =>
	async (...args: unknown[]) => {
		h.calls.push({ method, args });
	};

const buildConnection = (): Connection => ({
	openBox: async () => ({ uidvalidity: 1 }),
	copyMessages: async () => ({ uidMap: new Map([[10, 20]]) }),
	createMailbox: record("createMailbox") as Connection["createMailbox"],
});

const fresh = (): Harness => ({
	calls: [],
	account: { accountId: "acc-1", accountConfigId: "cfg-1" },
	mailbox: { mailboxId: "src-mbx", uidValidity: 1, cursorState: undefined },
	connection: buildConnection(),
	getConnectionCount: 0,
	disconnectCount: 0,
});

const deps = (): MessageCopyDeps =>
	({
		getClient: async () => ({
			account: {
				get: async (accountId: string) => {
					h.calls.push({ method: "account.get", args: [accountId] });
					return h.account;
				},
			},
			message: {
				updateUid: record("message.updateUid"),
				update: record("message.update"),
			},
			threadMessage: {
				findByMessageId: async (cfg: string) => ({
					accountConfigId: cfg,
					threadMessageId: "tm-1",
					sentDate: 1,
					mailboxId: "src-mbx",
					isRead: false,
					isDeleted: false,
					hasStars: false,
					hasAttachment: false,
				}),
				update: record("threadMessage.update"),
			},
			mailbox: {
				get: async () => h.mailbox,
				update: record("mailbox.update"),
			},
			secrets: {},
		}),
		buildLifecycleDeps: () => ({}),
		withOAuthLifecycle: async (
			_deps: unknown,
			_account: unknown,
			_log: unknown,
			cb: (credentials: unknown) => Promise<void>,
		) => cb({}),
		createConnectionScope: () => ({
			getConnection: async () => {
				h.getConnectionCount += 1;
				return h.connection;
			},
			disconnect: async () => {
				h.disconnectCount += 1;
			},
		}),
	}) as unknown as MessageCopyDeps;

const event: MessageCopyEvent = {
	type: "MESSAGE_COPY",
	accountId: "acc-1",
	sourceMessageId: "src-msg",
	newMessageId: "new-msg",
	sourceMailboxId: "src-mbx",
	sourceMailboxPath: "INBOX",
	destinationMailboxPath: "Archive",
	destinationMailboxId: "dst-mbx",
	uid: 10,
} as MessageCopyEvent;

const called = (method: string): Call[] =>
	h.calls.filter((c) => c.method === method);

describe("handleMessageCopy", () => {
	beforeEach(() => {
		h = fresh();
	});

	it("writes the new UID, marks the copy synced, and updates the thread row", async () => {
		await handleMessageCopy(event, noopLog, deps());

		assert.deepEqual(called("message.updateUid")[0]?.args, [
			"new-msg",
			20,
			"dst-mbx",
		]);
		const statusUpdate = called("message.update")[0];
		assert.equal(
			(statusUpdate?.args[1] as { syncStatus?: string })?.syncStatus,
			"synced",
		);
		assert.equal(called("threadMessage.update").length, 1);
		assert.equal(h.disconnectCount, 1, "the scope is always disconnected");
	});

	it("marks the copy failed when the COPYUID response omits the source uid", async () => {
		h.connection.copyMessages = async () => ({ uidMap: new Map() });

		await handleMessageCopy(event, noopLog, deps());

		assert.equal(called("message.updateUid").length, 0);
		const update = called("message.update")[0];
		assert.equal(
			(update?.args[1] as { syncStatus?: string })?.syncStatus,
			"failed",
		);
		assert.equal(called("threadMessage.update").length, 0);
	});

	it("returns early without connecting when the account is soft-deleted", async () => {
		h.account = {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			deletedAt: Date.now(),
		};

		await handleMessageCopy(event, noopLog, deps());

		assert.equal(h.getConnectionCount, 0);
	});

	it("throws when the account no longer exists", async () => {
		h.account = null;

		await assert.rejects(
			handleMessageCopy(event, noopLog, deps()),
			/not found/,
		);
	});

	it("skips the copy without opening a connection when the cursor is rebuilding", async () => {
		h.mailbox = {
			mailboxId: "src-mbx",
			uidValidity: 1,
			cursorState: "rebuilding",
		};

		await handleMessageCopy(event, noopLog, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("message.updateUid").length, 0);
	});

	it("pauses quietly when openBox trips a UIDVALIDITY mismatch", async () => {
		h.connection.openBox = async () => ({ uidvalidity: 999 });

		await handleMessageCopy(event, noopLog, deps());

		assert.equal(
			(called("mailbox.update")[0]?.args[2] as { cursorState?: string })
				?.cursorState,
			"cursor_invalid",
			"the mismatch trips the mailbox cursor",
		);
		assert.equal(called("message.updateUid").length, 0);
		assert.equal(h.disconnectCount, 1);
	});

	it("creates the destination and rethrows on a TRYCREATE error", async () => {
		h.connection.copyMessages = async () => {
			throw new Error("TRYCREATE: mailbox does not exist");
		};

		await assert.rejects(
			handleMessageCopy(event, noopLog, deps()),
			/TRYCREATE/,
		);

		assert.equal(called("createMailbox")[0]?.args[0], "Archive");
		assert.equal(h.getConnectionCount, 2, "reconnects to create the mailbox");
	});

	it("marks the copy deleted-and-failed when the source is gone on the server", async () => {
		h.connection.copyMessages = async () => {
			throw new Error("NONEXISTENT source message");
		};

		await handleMessageCopy(event, noopLog, deps());

		const update = called("message.update")[0];
		assert.equal((update?.args[1] as { status?: string })?.status, "deleted");
		assert.equal(called("createMailbox").length, 0);
	});

	it("marks failed and rethrows on an unclassified IMAP error", async () => {
		h.connection.copyMessages = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			handleMessageCopy(event, noopLog, deps()),
			/server exploded/,
		);

		const update = called("message.update")[0];
		assert.equal(
			(update?.args[1] as { syncStatus?: string })?.syncStatus,
			"failed",
		);
	});
});
