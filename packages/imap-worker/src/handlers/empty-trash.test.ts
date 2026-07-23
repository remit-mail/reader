import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Logger } from "@remit/logger-lambda";
import type { EmptyTrashEvent } from "../events.js";
import { type EmptyTrashDeps, handleEmptyTrash } from "./empty-trash.js";

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
	search: (criteria: string[]) => Promise<number[]>;
	deleteMessages: (uids: number[]) => Promise<void>;
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
	localMessages: { messageId: string }[];
	threadMessage: { accountConfigId: string; threadMessageId: string } | null;
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
	search: async () => [10, 11],
	deleteMessages: record(
		"connection.deleteMessages",
	) as Connection["deleteMessages"],
});

const fresh = (): Harness => ({
	calls: [],
	account: { accountId: "acc-1", accountConfigId: "cfg-1" },
	mailbox: { mailboxId: "trash-mbx", uidValidity: 1, cursorState: undefined },
	connection: buildConnection(),
	localMessages: [{ messageId: "msg-1" }, { messageId: "msg-2" }],
	threadMessage: { accountConfigId: "cfg-1", threadMessageId: "tm-1" },
	getConnectionCount: 0,
	disconnectCount: 0,
});

const deps = (): EmptyTrashDeps =>
	({
		getClient: async () => ({
			account: {
				get: async (accountId: string) => {
					h.calls.push({ method: "account.get", args: [accountId] });
					return h.account;
				},
			},
			message: {
				listAllByMailbox: async () => h.localMessages,
				delete: record("message.delete"),
			},
			threadMessage: {
				findByMessageId: async () => h.threadMessage,
				delete: record("threadMessage.delete"),
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
	}) as unknown as EmptyTrashDeps;

const event: EmptyTrashEvent = {
	type: "EMPTY_TRASH",
	accountId: "acc-1",
	trashMailboxId: "trash-mbx",
	trashMailboxPath: "Trash",
} as EmptyTrashEvent;

const called = (method: string): Call[] =>
	h.calls.filter((c) => c.method === method);

describe("handleEmptyTrash", () => {
	beforeEach(() => {
		h = fresh();
	});

	it("expunges every server uid and both local rows for each trashed message", async () => {
		await handleEmptyTrash(event, noopLog, deps());

		assert.deepEqual(called("connection.deleteMessages")[0]?.args, [[10, 11]]);
		assert.deepEqual(
			called("message.delete").map((c) => c.args[0]),
			["msg-1", "msg-2"],
		);
		assert.equal(called("threadMessage.delete").length, 2);
		assert.equal(h.disconnectCount, 1, "the scope is always disconnected");
	});

	it("skips the IMAP expunge when the trash is already empty on the server", async () => {
		h.connection.search = async () => [];

		await handleEmptyTrash(event, noopLog, deps());

		assert.equal(called("connection.deleteMessages").length, 0);
		assert.equal(
			called("message.delete").length,
			2,
			"local rows are still cleaned up",
		);
	});

	it("deletes the message even when it has no thread row", async () => {
		h.threadMessage = null;

		await handleEmptyTrash(event, noopLog, deps());

		assert.equal(called("message.delete").length, 2);
		assert.equal(called("threadMessage.delete").length, 0);
	});

	it("returns early without connecting when the account is soft-deleted", async () => {
		h.account = {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			deletedAt: Date.now(),
		};

		await handleEmptyTrash(event, noopLog, deps());

		assert.equal(h.getConnectionCount, 0);
	});

	it("throws when the account no longer exists", async () => {
		h.account = null;

		await assert.rejects(handleEmptyTrash(event, noopLog, deps()), /not found/);
	});

	it("skips without opening a connection when the cursor is rebuilding", async () => {
		h.mailbox = {
			mailboxId: "trash-mbx",
			uidValidity: 1,
			cursorState: "rebuilding",
		};

		await handleEmptyTrash(event, noopLog, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("message.delete").length, 0);
	});

	it("pauses quietly when openBox trips a UIDVALIDITY mismatch", async () => {
		h.connection.openBox = async () => ({ uidvalidity: 999 });

		await handleEmptyTrash(event, noopLog, deps());

		assert.equal(
			(called("mailbox.update")[0]?.args[2] as { cursorState?: string })
				?.cursorState,
			"cursor_invalid",
		);
		assert.equal(called("message.delete").length, 0);
		assert.equal(h.disconnectCount, 1);
	});

	it("rethrows an unclassified IMAP error so the event is retried", async () => {
		h.connection.search = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			handleEmptyTrash(event, noopLog, deps()),
			/server exploded/,
		);

		assert.equal(h.disconnectCount, 1);
	});
});
