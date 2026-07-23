import assert from "node:assert";
import { beforeEach, describe, it, mock } from "node:test";
import type { ThreadMessageItem } from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import type { MessageDeleteEvent } from "../events.js";
import {
	buildThreadMessageTrashUpdate,
	deleteAllThreadMessagesForMessage,
	handleMessageDelete,
	type MessageDeleteDeps,
} from "./message-delete.js";

const sourceMailboxId = "source-mailbox-id-aaaaaaaaa";
const trashMailboxId = "trash-mailbox-id-aaaaaaaaa";

const baseThreadMessage = {
	sentDate: 1700000000000,
	mailboxId: sourceMailboxId,
	isRead: true,
	isDeleted: false,
	hasStars: true,
	hasAttachment: false,
} satisfies Pick<
	ThreadMessageItem,
	| "sentDate"
	| "mailboxId"
	| "isRead"
	| "isDeleted"
	| "hasStars"
	| "hasAttachment"
>;

describe("buildThreadMessageTrashUpdate", () => {
	// Regression for the same composites-direction landmine PR #186 fixed in
	// `flag-queue.ts`. The CURRENT row state must go in `composites`; the NEW
	// values must go in `set`. Flipping any of these silently drops the
	// move-to-trash update on the ThreadMessage row — IMAP shows the message in
	// Trash but the local thread-list still shows it in the source mailbox.

	it("set carries the NEW uid, destination mailboxId, and isDeleted=true", () => {
		const args = buildThreadMessageTrashUpdate(
			baseThreadMessage,
			42,
			trashMailboxId,
		);

		assert.strictEqual(args.set.uid, 42);
		assert.strictEqual(
			args.set.mailboxId,
			trashMailboxId,
			"set.mailboxId must be the NEW trash mailbox",
		);
		assert.strictEqual(
			args.set.isDeleted,
			true,
			"set.isDeleted must be true (move-to-trash marks the row deleted)",
		);
	});

	it("composites.mailboxId is the CURRENT (source) mailboxId, not Trash", () => {
		const args = buildThreadMessageTrashUpdate(
			baseThreadMessage,
			42,
			trashMailboxId,
		);

		assert.strictEqual(
			args.composites.mailboxId,
			sourceMailboxId,
			"composites.mailboxId must be the CURRENT source mailbox; passing Trash breaks the conditional check",
		);
		assert.notStrictEqual(
			args.composites.mailboxId,
			trashMailboxId,
			"composites.mailboxId must NOT match the new trash mailbox id",
		);
	});

	it("composites.isDeleted is the CURRENT value, not the new true", () => {
		const args = buildThreadMessageTrashUpdate(
			baseThreadMessage,
			42,
			trashMailboxId,
		);

		assert.strictEqual(
			args.composites.isDeleted,
			false,
			"composites.isDeleted must be the CURRENT value (false), not the new value (true)",
		);
	});

	it("composites mirrors every CURRENT indexed attribute on the threadMessage", () => {
		const tm = {
			sentDate: 1700000000123,
			mailboxId: sourceMailboxId,
			isRead: false,
			isDeleted: false,
			hasStars: true,
			hasAttachment: true,
		};

		const args = buildThreadMessageTrashUpdate(tm, 99, trashMailboxId);

		assert.deepStrictEqual(args.composites, {
			sentDate: tm.sentDate,
			mailboxId: tm.mailboxId,
			isRead: tm.isRead,
			isDeleted: tm.isDeleted,
			hasStars: tm.hasStars,
			hasAttachment: tm.hasAttachment,
		});
	});
});

describe("deleteAllThreadMessagesForMessage (#212)", () => {
	// Regression for the multi-mailbox cleanup gap in #212. A single Message
	// can have ThreadMessage rows in multiple mailboxes (e.g. INBOX + a label
	// folder copy). The pre-fix code used `findByMessageId` (single row) and
	// left orphan rows behind that then leaked into other mailbox listings.

	const baseRow = (
		threadMessageId: string,
		mailboxId: string,
	): Pick<
		ThreadMessageItem,
		"accountConfigId" | "threadMessageId" | "mailboxId"
	> => ({
		accountConfigId: "alice-config-aaaaaaaaaa",
		threadMessageId,
		mailboxId,
	});

	it("deletes every ThreadMessage row returned by findAllByMessageId", async () => {
		const rows = [
			baseRow("alice-tm-1-aaaaaaaaaa", "alice-inbox-aaaaaaaaa"),
			baseRow("alice-tm-2-aaaaaaaaaa", "alice-label-aaaaaaaaa"),
		];

		const findAllByMessageId = mock.fn(async () => rows);
		const deleteRow = mock.fn(async () => undefined);

		const count = await deleteAllThreadMessagesForMessage(
			{
				findAllByMessageId,
				delete: deleteRow,
			} as unknown as Parameters<typeof deleteAllThreadMessagesForMessage>[0],
			"alice-config-aaaaaaaaaa",
			"alice-msg-multi-aaaaaaaa",
		);

		assert.equal(count, 2);
		assert.equal(deleteRow.mock.calls.length, 2);
		assert.deepEqual(deleteRow.mock.calls[0].arguments, [
			"alice-config-aaaaaaaaaa",
			"alice-tm-1-aaaaaaaaaa",
		]);
		assert.deepEqual(deleteRow.mock.calls[1].arguments, [
			"alice-config-aaaaaaaaaa",
			"alice-tm-2-aaaaaaaaaa",
		]);
	});

	it("returns zero when no ThreadMessage rows exist", async () => {
		const findAllByMessageId = mock.fn(async () => []);
		const deleteRow = mock.fn(async () => undefined);

		const count = await deleteAllThreadMessagesForMessage(
			{
				findAllByMessageId,
				delete: deleteRow,
			} as unknown as Parameters<typeof deleteAllThreadMessagesForMessage>[0],
			"alice-config-aaaaaaaaaa",
			"alice-msg-missing-aaaaaa",
		);

		assert.equal(count, 0);
		assert.equal(deleteRow.mock.calls.length, 0);
	});
});

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
	moveMessages: (
		uids: number[],
		dest: string,
	) => Promise<{ uidMap: Map<number, number> }>;
	deleteMessages: (uids: number[]) => Promise<void>;
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
	threadMessage: Record<string, unknown> | null;
	allThreadMessages: { accountConfigId: string; threadMessageId: string }[];
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
	moveMessages: async () => ({ uidMap: new Map([[10, 20]]) }),
	deleteMessages: record(
		"connection.deleteMessages",
	) as Connection["deleteMessages"],
	createMailbox: record(
		"connection.createMailbox",
	) as Connection["createMailbox"],
});

const fresh = (): Harness => ({
	calls: [],
	account: { accountId: "acc-1", accountConfigId: "cfg-1" },
	mailbox: { mailboxId: "src-mbx", uidValidity: 1, cursorState: undefined },
	connection: buildConnection(),
	threadMessage: {
		...baseThreadMessage,
		accountConfigId: "cfg-1",
		threadMessageId: "tm-1",
	},
	allThreadMessages: [
		{ accountConfigId: "cfg-1", threadMessageId: "tm-1" },
		{ accountConfigId: "cfg-1", threadMessageId: "tm-2" },
	],
	getConnectionCount: 0,
	disconnectCount: 0,
});

const deps = (): MessageDeleteDeps =>
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
				delete: record("message.delete"),
			},
			threadMessage: {
				findByMessageId: async () => h.threadMessage,
				findAllByMessageId: async () => h.allThreadMessages,
				update: record("threadMessage.update"),
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
	}) as unknown as MessageDeleteDeps;

const moveEvent: MessageDeleteEvent = {
	type: "MESSAGE_DELETE",
	accountId: "acc-1",
	messageId: "msg-1",
	mailboxId: "src-mbx",
	mailboxPath: "INBOX",
	uid: 10,
	operation: "move_to_trash",
	destinationMailboxId: "trash-mbx",
	destinationMailboxPath: "Trash",
} as MessageDeleteEvent;

const permanentEvent: MessageDeleteEvent = {
	type: "MESSAGE_DELETE",
	accountId: "acc-1",
	messageId: "msg-1",
	mailboxId: "src-mbx",
	mailboxPath: "INBOX",
	uid: 10,
	operation: "permanent_delete",
} as MessageDeleteEvent;

const called = (method: string): Call[] =>
	h.calls.filter((c) => c.method === method);

describe("handleMessageDelete", () => {
	beforeEach(() => {
		h = fresh();
	});

	it("moves to trash, rewrites the uid, and flips the thread row to deleted", async () => {
		await handleMessageDelete(moveEvent, noopLog, deps());

		assert.deepEqual(called("message.updateUid")[0]?.args, [
			"msg-1",
			20,
			"trash-mbx",
		]);
		const update = called("threadMessage.update")[0];
		assert.deepEqual(update?.args[2], {
			uid: 20,
			mailboxId: "trash-mbx",
			isDeleted: true,
		});
		assert.equal(h.disconnectCount, 1);
	});

	it("marks the message failed when the MOVE returns no new uid", async () => {
		h.connection.moveMessages = async () => ({ uidMap: new Map() });

		await handleMessageDelete(moveEvent, noopLog, deps());

		assert.equal(called("message.updateUid").length, 0);
		assert.equal(
			(called("message.update")[0]?.args[1] as { syncStatus?: string })
				?.syncStatus,
			"failed",
		);
	});

	it("expunges on the server and removes every thread row before the message row", async () => {
		await handleMessageDelete(permanentEvent, noopLog, deps());

		assert.deepEqual(called("connection.deleteMessages")[0]?.args, [[10]]);
		assert.equal(called("threadMessage.delete").length, 2);
		assert.ok(
			h.calls.findIndex((c) => c.method === "threadMessage.delete") <
				h.calls.findIndex((c) => c.method === "message.delete"),
			"thread rows go first so no row outlives its message",
		);
	});

	it("cleans up locally and swallows the error when the message is already gone on IMAP", async () => {
		h.connection.deleteMessages = async () => {
			throw new Error("NONEXISTENT uid");
		};

		await handleMessageDelete(permanentEvent, noopLog, deps());

		assert.equal(called("message.delete").length, 1);
		assert.equal(called("threadMessage.delete").length, 2);
	});

	it("creates the trash mailbox and rethrows on TRYCREATE", async () => {
		h.connection.moveMessages = async () => {
			throw new Error("TRYCREATE: no such mailbox");
		};

		await assert.rejects(
			handleMessageDelete(moveEvent, noopLog, deps()),
			/TRYCREATE/,
		);

		assert.equal(called("connection.createMailbox")[0]?.args[0], "Trash");
		assert.equal(h.getConnectionCount, 2, "reconnects to create the mailbox");
	});

	it("marks failed and rethrows on an unclassified IMAP error", async () => {
		h.connection.moveMessages = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			handleMessageDelete(moveEvent, noopLog, deps()),
			/server exploded/,
		);

		assert.equal(
			(called("message.update")[0]?.args[1] as { syncStatus?: string })
				?.syncStatus,
			"failed",
		);
	});

	it("pauses quietly when openBox trips a UIDVALIDITY mismatch", async () => {
		h.connection.openBox = async () => ({ uidvalidity: 999 });

		await handleMessageDelete(moveEvent, noopLog, deps());

		assert.equal(
			(called("mailbox.update")[0]?.args[2] as { cursorState?: string })
				?.cursorState,
			"cursor_invalid",
		);
		assert.equal(called("message.updateUid").length, 0);
	});

	it("skips without opening a connection when the cursor is rebuilding", async () => {
		h.mailbox = {
			mailboxId: "src-mbx",
			uidValidity: 1,
			cursorState: "rebuilding",
		};

		await handleMessageDelete(moveEvent, noopLog, deps());

		assert.equal(h.getConnectionCount, 0);
	});

	it("returns early without connecting when the account is soft-deleted", async () => {
		h.account = {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			deletedAt: Date.now(),
		};

		await handleMessageDelete(moveEvent, noopLog, deps());

		assert.equal(h.getConnectionCount, 0);
	});

	it("throws when the account no longer exists", async () => {
		h.account = null;

		await assert.rejects(
			handleMessageDelete(moveEvent, noopLog, deps()),
			/not found/,
		);
	});
});
