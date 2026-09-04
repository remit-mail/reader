import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { RoleResolution } from "@remit/data-ports/folder-role";
import { noopLogger } from "@remit/logger-lambda/noop-logger";
import type { EmptyTrashEvent } from "../events.js";
import { type EmptyTrashDeps, handleEmptyTrash } from "./empty-trash.js";

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

interface LocalMessage {
	messageId: string;
	uid: number;
	status: string;
}

type TrashMailbox = { mailboxId: string; fullPath: string };

interface Harness {
	calls: Call[];
	account: {
		accountId: string;
		accountConfigId: string;
		deletedAt?: number;
	} | null;
	mailbox: { mailboxId: string; uidValidity: number; cursorState?: string };
	mailboxError?: Error;
	trashResolution: RoleResolution<TrashMailbox>;
	connection: Connection;
	localMessages: LocalMessage[];
	threadMessage: boolean;
	messagesWithoutListingRow: string[];
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

const deleting = (messageId: string, uid: number): LocalMessage => ({
	messageId,
	uid,
	status: "deleting",
});

const fresh = (): Harness => ({
	calls: [],
	account: { accountId: "acc-1", accountConfigId: "cfg-1" },
	mailbox: { mailboxId: "trash-mbx", uidValidity: 1, cursorState: undefined },
	trashResolution: {
		kind: "flagged",
		mailbox: { mailboxId: "trash-mbx", fullPath: "Trash" },
	},
	connection: buildConnection(),
	localMessages: [deleting("msg-1", 10), deleting("msg-2", 11)],
	threadMessage: true,
	messagesWithoutListingRow: [],
	getConnectionCount: 0,
	disconnectCount: 0,
});

// Empty Trash only flips `isDeleted` on the listing row, so its presence is how
// the revert tells its own marks from a permanent delete's (which removes them
// up front).
const listingRow = (messageId: string) =>
	h.messagesWithoutListingRow.includes(messageId) || !h.threadMessage
		? null
		: {
				accountConfigId: "cfg-1",
				threadMessageId: `tm-${messageId}`,
				sentDate: 1_700_000_000_000,
				mailboxId: "trash-mbx",
				isRead: false,
				isDeleted: true,
				hasStars: false,
				hasAttachment: false,
			};

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
				update: record("message.update"),
			},
			threadMessage: {
				findByMessageId: async (_cfg: string, messageId: string) =>
					listingRow(messageId),
				findAllByMessageId: async (_cfg: string, messageId: string) => {
					const row = listingRow(messageId);
					return row ? [row] : [];
				},
				delete: record("threadMessage.delete"),
				update: record("threadMessage.update"),
			},
			mailbox: {
				get: async () => {
					if (h.mailboxError) throw h.mailboxError;
					return h.mailbox;
				},
				update: record("mailbox.update"),
			},
			mailboxSpecialUse: {
				resolveTrashRole: async () => h.trashResolution,
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
	schemaVersion: 2,
	accountId: "acc-1",
	trashMailboxId: "trash-mbx",
	trashMailboxPath: "Trash",
	trashUidValidity: 1,
} as EmptyTrashEvent;

const called = (method: string): Call[] =>
	h.calls.filter((c) => c.method === method);

const revertedMessageIds = (): string[] =>
	called("message.update")
		.filter(
			(c) =>
				(c.args[1] as { status?: string; syncStatus?: string }).status ===
					"active" &&
				(c.args[1] as { syncStatus?: string }).syncStatus === "synced",
		)
		.map((c) => c.args[0] as string);

const undeletedThreadMessageIds = (): string[] =>
	called("threadMessage.update")
		.filter((c) => (c.args[2] as { isDeleted?: boolean }).isDeleted === false)
		.map((c) => c.args[1] as string);

describe("handleEmptyTrash", () => {
	beforeEach(() => {
		h = fresh();
	});

	it("expunges every server uid and both local rows for each trashed message", async () => {
		await handleEmptyTrash(event, noopLogger, deps());

		assert.deepEqual(called("connection.deleteMessages")[0]?.args, [[10, 11]]);
		assert.deepEqual(
			called("message.delete").map((c) => c.args[0]),
			["msg-1", "msg-2"],
		);
		assert.equal(called("threadMessage.delete").length, 2);
		assert.equal(h.disconnectCount, 1, "the scope is always disconnected");
	});

	it("keeps the local row for a uid the expunge never covered", async () => {
		// Mail that reached Trash after the SEARCH — or a move the unordered dev
		// queue let outrun this event — is still on the server, so deleting its
		// rows would hide mail the user can still see in another client.
		h.localMessages = [
			deleting("msg-1", 10),
			deleting("msg-2", 11),
			{ messageId: "msg-late", uid: 12, status: "active" },
		];

		await handleEmptyTrash(event, noopLogger, deps());

		assert.deepEqual(
			called("message.delete").map((c) => c.args[0]),
			["msg-1", "msg-2"],
		);
	});

	it("hands every row back when another client emptied the trash first", async () => {
		// Apple Mail got there first, so the SEARCH is empty and this expunge
		// covers nothing. Leaving the rows `deleting` hides mail that no longer
		// exists anywhere, with nothing left to clear the mark.
		h.connection.search = async () => [];

		await handleEmptyTrash(event, noopLogger, deps());

		assert.equal(called("connection.deleteMessages").length, 0);
		assert.equal(called("message.delete").length, 0);
		assert.deepEqual(revertedMessageIds(), ["msg-1", "msg-2"]);
		assert.deepEqual(undeletedThreadMessageIds(), ["tm-msg-1", "tm-msg-2"]);
	});

	it("hands back what a partial sweep left when the event is redelivered", async () => {
		// The first attempt expunged and cleaned up msg-1, then died before
		// msg-2. On redelivery the server has nothing left to find, and msg-2
		// would otherwise sit marked for a deletion that will never come.
		h.localMessages = [deleting("msg-2", 11)];
		h.connection.search = async () => [];

		await handleEmptyTrash(event, noopLogger, deps());

		assert.equal(called("message.delete").length, 0);
		assert.deepEqual(revertedMessageIds(), ["msg-2"]);
	});

	it("leaves a row whose listing rows another operation already removed", async () => {
		// A permanent delete inside Trash removes its listing rows up front and
		// marks the Message `deleting`. Reverting it here would resurrect a row
		// that operation is about to remove.
		h.localMessages = [deleting("msg-1", 10), deleting("msg-expunging", 12)];
		h.messagesWithoutListingRow = ["msg-expunging"];
		h.connection.search = async () => [];

		await handleEmptyTrash(event, noopLogger, deps());

		assert.deepEqual(revertedMessageIds(), ["msg-1"]);
	});

	it("deletes the message even when it has no thread row", async () => {
		h.threadMessage = false;

		await handleEmptyTrash(event, noopLogger, deps());

		assert.equal(called("message.delete").length, 2);
		assert.equal(called("threadMessage.delete").length, 0);
	});

	it("returns early without connecting when the account is soft-deleted", async () => {
		h.account = {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			deletedAt: Date.now(),
		};

		await handleEmptyTrash(event, noopLogger, deps());

		assert.equal(h.getConnectionCount, 0);
	});

	it("throws when the account no longer exists", async () => {
		h.account = null;

		await assert.rejects(
			handleEmptyTrash(event, noopLogger, deps()),
			/not found/,
		);
	});

	it("acks terminally without connecting when the Trash mailbox was deleted", async () => {
		h.mailboxError = Object.assign(new Error("Mailbox not found: trash-mbx"), {
			name: "NotFoundError",
		});

		await handleEmptyTrash(event, noopLogger, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("message.delete").length, 0);
	});

	it("abandons and reverts an event minted under an unknown contract", async () => {
		const unversioned = {
			type: "EMPTY_TRASH",
			accountId: "acc-1",
			trashMailboxId: "trash-mbx",
			trashMailboxPath: "Trash",
		} as unknown as EmptyTrashEvent;

		await handleEmptyTrash(unversioned, noopLogger, deps());

		assert.equal(h.getConnectionCount, 0, "no connection is ever opened");
		assert.equal(called("connection.deleteMessages").length, 0);
		assert.deepEqual(revertedMessageIds(), ["msg-1", "msg-2"]);
		assert.deepEqual(undeletedThreadMessageIds(), ["tm-msg-1", "tm-msg-2"]);
	});

	it("abandons when the Trash role now names a different folder", async () => {
		h.trashResolution = {
			kind: "appointed",
			mailbox: { mailboxId: "other-mbx", fullPath: "INBOX/Bak" },
		};

		await handleEmptyTrash(event, noopLogger, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("connection.deleteMessages").length, 0);
		assert.deepEqual(revertedMessageIds(), ["msg-1", "msg-2"]);
	});

	it("abandons when the Trash role no longer rests on confirmed evidence", async () => {
		h.trashResolution = {
			kind: "proposed",
			mailbox: { mailboxId: "trash-mbx", fullPath: "Trash" },
		};

		await handleEmptyTrash(event, noopLogger, deps());

		assert.equal(called("connection.deleteMessages").length, 0);
		assert.deepEqual(revertedMessageIds(), ["msg-1", "msg-2"]);
	});

	it("refuses the expunge when the served UIDVALIDITY is not the one consented to", async () => {
		// The path was reused: a third-party client renamed Trash away and made a
		// fresh one. Same path, different folder, and nobody consented to empty it.
		h.connection.openBox = async () => ({ uidvalidity: 77 });
		h.mailbox = { mailboxId: "trash-mbx", uidValidity: 77 };

		await handleEmptyTrash(event, noopLogger, deps());

		assert.equal(called("connection.deleteMessages").length, 0);
		assert.deepEqual(revertedMessageIds(), ["msg-1", "msg-2"]);
		assert.deepEqual(undeletedThreadMessageIds(), ["tm-msg-1", "tm-msg-2"]);
		assert.equal(h.disconnectCount, 1);
	});

	it("reverts only the rows this empty marked, never a freshly synced one", async () => {
		h.localMessages = [
			deleting("msg-1", 10),
			{ messageId: "msg-arrived", uid: 12, status: "active" },
		];
		h.connection.openBox = async () => ({ uidvalidity: 77 });
		h.mailbox = { mailboxId: "trash-mbx", uidValidity: 77 };

		await handleEmptyTrash(event, noopLogger, deps());

		assert.deepEqual(revertedMessageIds(), ["msg-1"]);
		assert.deepEqual(undeletedThreadMessageIds(), ["tm-msg-1"]);
	});

	it("reverts the marks when openBox trips a UIDVALIDITY mismatch", async () => {
		// The event is acked and nothing re-issues it, so leaving the folder
		// marked `deleting` hides healthy mail until the user notices.
		h.connection.openBox = async () => ({ uidvalidity: 999 });

		await handleEmptyTrash(event, noopLogger, deps());

		assert.equal(
			(called("mailbox.update")[0]?.args[2] as { cursorState?: string })
				?.cursorState,
			"cursor_invalid",
		);
		assert.equal(called("message.delete").length, 0);
		assert.deepEqual(revertedMessageIds(), ["msg-1", "msg-2"]);
		assert.equal(h.disconnectCount, 1);
	});

	it("reverts the marks without connecting when the cursor is rebuilding", async () => {
		h.mailbox = {
			mailboxId: "trash-mbx",
			uidValidity: 1,
			cursorState: "rebuilding",
		};

		await handleEmptyTrash(event, noopLogger, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("message.delete").length, 0);
		assert.deepEqual(revertedMessageIds(), ["msg-1", "msg-2"]);
	});

	it("rethrows an unclassified IMAP error so the event is retried", async () => {
		h.connection.search = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			handleEmptyTrash(event, noopLogger, deps()),
			/server exploded/,
		);

		assert.equal(h.disconnectCount, 1);
	});
});
