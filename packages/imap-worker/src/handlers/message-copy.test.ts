import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { noopLogger } from "@remit/logger-lambda/noop-logger";
import type { MessageCopyEvent } from "../events.js";
import { handleMessageCopy, type MessageCopyDeps } from "./message-copy.js";

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
	search: (criteria: unknown[]) => Promise<number[]>;
	createMailbox: (path: string) => Promise<void>;
}

interface CopyRow {
	messageId: string;
	mailboxId: string;
	uid: number;
	status: string;
	syncStatus: string;
	messageIdHeader?: string;
}

interface Harness {
	calls: Call[];
	account: {
		accountId: string;
		accountConfigId: string;
		deletedAt?: number;
	} | null;
	mailbox: { mailboxId: string; uidValidity: number; cursorState?: string };
	mailboxError?: Error;
	copyRow: CopyRow | null;
	destinationHolds: number[];
	connection: Connection;
	getConnectionCount: number;
	disconnectCount: number;
}

let h: Harness;

const notFoundError = (): Error =>
	Object.assign(new Error("Mailbox not found: src-mbx"), {
		name: "NotFoundError",
	});

const record =
	(method: string) =>
	async (...args: unknown[]) => {
		h.calls.push({ method, args });
	};

const buildConnection = (): Connection => ({
	openBox: async (path: string, readOnly?: boolean) => {
		h.calls.push({ method: "openBox", args: [path, readOnly] });
		return { uidvalidity: 1 };
	},
	copyMessages: async (uids: number[], dest: string) => {
		h.calls.push({ method: "copyMessages", args: [uids, dest] });
		return { uidMap: new Map([[10, 20]]) };
	},
	search: async (criteria: unknown[]) => {
		h.calls.push({ method: "search", args: criteria });
		return h.destinationHolds;
	},
	createMailbox: record("createMailbox") as Connection["createMailbox"],
});

const unsettledCopyRow = (): CopyRow => ({
	messageId: "new-msg",
	mailboxId: "dst-mbx",
	uid: 0,
	status: "moving",
	syncStatus: "pending",
	messageIdHeader: "<abc@example.com>",
});

const fresh = (): Harness => ({
	calls: [],
	account: { accountId: "acc-1", accountConfigId: "cfg-1" },
	mailbox: { mailboxId: "src-mbx", uidValidity: 1, cursorState: undefined },
	copyRow: unsettledCopyRow(),
	destinationHolds: [],
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
				get: async (messageIds: string[]) => {
					h.calls.push({ method: "message.get", args: [messageIds] });
					return h.copyRow ? [h.copyRow] : [];
				},
				updateUid: record("message.updateUid"),
				update: record("message.update"),
				delete: record("message.delete"),
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
				findAllByMessageId: async (cfg: string) => [
					{ accountConfigId: cfg, threadMessageId: "tm-1" },
				],
				deleteMany: record("threadMessage.deleteMany"),
				update: record("threadMessage.update"),
			},
			mailbox: {
				get: async () => {
					if (h.mailboxError) throw h.mailboxError;
					return h.mailbox;
				},
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

const askedTheDestination = (): boolean =>
	called("search").length > 0 &&
	called("openBox").some((c) => c.args[0] === "Archive");

describe("handleMessageCopy", () => {
	beforeEach(() => {
		h = fresh();
	});

	it("writes the new UID, marks the copy synced, and updates the thread row", async () => {
		await handleMessageCopy(event, noopLogger, 1, deps());

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

	it("settles on the destination UID when a server without UIDPLUS omits COPYUID", async () => {
		h.connection.copyMessages = async () => ({ uidMap: new Map() });
		h.destinationHolds = [42];

		await handleMessageCopy(event, noopLogger, 1, deps());

		assert.ok(askedTheDestination(), "the destination was asked for the copy");
		assert.deepEqual(called("message.updateUid")[0]?.args, [
			"new-msg",
			42,
			"dst-mbx",
		]);
		assert.equal(
			(called("message.update")[0]?.args[1] as { syncStatus?: string })
				?.syncStatus,
			"synced",
		);
		assert.equal(called("threadMessage.update").length, 1);
	});

	it("reconciles the optimistic row away when the destination does not hold the copy", async () => {
		h.connection.copyMessages = async () => ({ uidMap: new Map() });
		h.destinationHolds = [];

		await handleMessageCopy(event, noopLogger, 1, deps());

		assert.ok(askedTheDestination());
		assert.equal(called("message.delete")[0]?.args[0], "new-msg");
		assert.equal(called("threadMessage.deleteMany").length, 1);
		assert.equal(called("message.updateUid").length, 0);
	});

	it("settles a copy it cannot probe instead of retrying it into duplicates", async () => {
		let copies = 0;
		h.connection.copyMessages = async () => {
			copies += 1;
			return { uidMap: new Map() };
		};
		h.copyRow = { ...unsettledCopyRow(), messageIdHeader: undefined };

		await handleMessageCopy(event, noopLogger, 1, deps());

		assert.equal(copies, 1, "the COPY is issued once");
		assert.equal(called("search").length, 0, "there is nothing to ask with");
		const update = called("message.update")[0];
		assert.equal((update?.args[1] as { status?: string })?.status, "deleted");
		assert.equal(
			(update?.args[1] as { syncStatus?: string })?.syncStatus,
			"failed",
		);
		assert.equal(called("message.delete").length, 0, "no row is thrown away");
	});

	it("never copies twice when a redelivered copy already landed", async () => {
		h.destinationHolds = [42];

		await handleMessageCopy(event, noopLogger, 2, deps());

		assert.equal(called("copyMessages").length, 0);
		assert.deepEqual(called("message.updateUid")[0]?.args, [
			"new-msg",
			42,
			"dst-mbx",
		]);
	});

	it("never copies twice when a redelivered copy cannot be probed", async () => {
		h.copyRow = { ...unsettledCopyRow(), messageIdHeader: undefined };
		let copies = 0;
		h.connection.copyMessages = async () => {
			copies += 1;
			// The COPY lands, then the tagged OK is lost with the connection.
			throw new Error("connection reset by peer");
		};

		await assert.rejects(
			handleMessageCopy(event, noopLogger, 1, deps()),
			/connection reset/,
		);
		await handleMessageCopy(event, noopLogger, 2, deps());

		assert.equal(copies, 1, "the redelivery issues no second COPY");
		assert.equal(called("search").length, 0);
		const settled = called("message.update").at(-1);
		assert.equal((settled?.args[1] as { status?: string })?.status, "deleted");
	});

	it("acks a copy that already settled without touching IMAP", async () => {
		h.copyRow = {
			...unsettledCopyRow(),
			uid: 20,
			status: "active",
			syncStatus: "synced",
		};

		await handleMessageCopy(event, noopLogger, 2, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("copyMessages").length, 0);
	});

	it("acks when the copy row no longer exists", async () => {
		h.copyRow = null;

		await handleMessageCopy(event, noopLogger, 1, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("message.update").length, 0);
	});

	it("returns early without connecting when the account is soft-deleted", async () => {
		h.account = {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			deletedAt: Date.now(),
		};

		await handleMessageCopy(event, noopLogger, 1, deps());

		assert.equal(h.getConnectionCount, 0);
	});

	it("throws when the account no longer exists", async () => {
		h.account = null;

		await assert.rejects(
			handleMessageCopy(event, noopLogger, 1, deps()),
			/not found/,
		);
	});

	it("acks terminally without connecting when the source mailbox was deleted", async () => {
		h.mailboxError = notFoundError();

		await handleMessageCopy(event, noopLogger, 1, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("message.updateUid").length, 0);
		assert.equal(called("message.update").length, 0);
	});

	it("skips the copy without opening a connection when the cursor is rebuilding", async () => {
		h.mailbox = {
			mailboxId: "src-mbx",
			uidValidity: 1,
			cursorState: "rebuilding",
		};

		await handleMessageCopy(event, noopLogger, 1, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("message.updateUid").length, 0);
	});

	it("pauses quietly when openBox trips a UIDVALIDITY mismatch", async () => {
		h.connection.openBox = async () => ({ uidvalidity: 999 });

		await handleMessageCopy(event, noopLogger, 1, deps());

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
			handleMessageCopy(event, noopLogger, 1, deps()),
			/TRYCREATE/,
		);

		assert.equal(called("createMailbox")[0]?.args[0], "Archive");
		assert.equal(h.getConnectionCount, 2, "reconnects to create the mailbox");
	});

	it("marks the copy deleted-and-failed when the source is gone on the server", async () => {
		h.connection.copyMessages = async () => {
			throw new Error("NONEXISTENT source message");
		};

		await handleMessageCopy(event, noopLogger, 1, deps());

		const update = called("message.update")[0];
		assert.equal((update?.args[1] as { status?: string })?.status, "deleted");
		assert.equal(called("createMailbox").length, 0);
	});

	it("marks failed and rethrows on an unclassified IMAP error within the budget", async () => {
		h.connection.copyMessages = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			handleMessageCopy(event, noopLogger, 1, deps()),
			/server exploded/,
		);

		const update = called("message.update")[0];
		assert.equal(
			(update?.args[1] as { syncStatus?: string })?.syncStatus,
			"failed",
		);
	});

	it("settles on the destination UID instead of dead-lettering the last attempt", async () => {
		h.connection.copyMessages = async () => {
			throw new Error("server exploded");
		};
		let asked = 0;
		h.connection.search = async (criteria: unknown[]) => {
			h.calls.push({ method: "search", args: criteria });
			asked += 1;
			return asked === 1 ? [] : [42];
		};

		await handleMessageCopy(event, noopLogger, 3, deps());

		assert.deepEqual(called("message.updateUid")[0]?.args, [
			"new-msg",
			42,
			"dst-mbx",
		]);
	});

	it("reconciles the row away when the last attempt finds nothing at the destination", async () => {
		h.connection.copyMessages = async () => {
			throw new Error("server exploded");
		};
		h.destinationHolds = [];

		await handleMessageCopy(event, noopLogger, 3, deps());

		assert.equal(called("message.delete")[0]?.args[0], "new-msg");
		assert.equal(called("threadMessage.deleteMany").length, 1);
	});
});
