import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Logger } from "@remit/logger-lambda";
import type { MessageCopyEvent } from "../events.js";
import {
	getMessageCopyMaxAttempts,
	handleMessageCopy,
	MESSAGE_COPY_MAX_ATTEMPTS,
	type MessageCopyDeps,
} from "./message-copy.js";

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
	search: (criteria: unknown[]) => Promise<number[]>;
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
	messageRow: { messageIdHeader?: string } | undefined;
	destinationSearchUids: number[];
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

// The destination box deliberately answers a DIFFERENT uidvalidity than the
// source snapshot (h.mailbox.uidValidity = 1): a probe routed through the
// guardConnectionCursor wrap would compare it against the SOURCE snapshot,
// trip the mailbox and throw — so any test that settles a probed uid pins the
// raw-connection wiring structurally (review of #1102).
const buildConnection = (): Connection => ({
	openBox: async (path: string) => ({
		uidvalidity: path === "INBOX" ? 1 : 2,
	}),
	copyMessages: async () => ({ uidMap: new Map([[10, 20]]) }),
	createMailbox: record("createMailbox") as Connection["createMailbox"],
	search: async (...args: unknown[]) => {
		h.calls.push({ method: "connection.search", args });
		const criteria = args[0];
		return Array.isArray(criteria) &&
			Array.isArray(criteria[0]) &&
			criteria[0][0] === "HEADER"
			? h.destinationSearchUids
			: [10];
	},
});

const fresh = (): Harness => ({
	calls: [],
	account: { accountId: "acc-1", accountConfigId: "cfg-1" },
	mailbox: { mailboxId: "src-mbx", uidValidity: 1, cursorState: undefined },
	messageRow: { messageIdHeader: "<copied-message@example.com>" },
	destinationSearchUids: [],
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
					return h.messageRow ? [h.messageRow] : [];
				},
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

// A copy whose destination is its own source mailbox — the shape the enqueue
// path now rejects, but an in-flight event can still carry (review of #1102).
const sameMailboxEvent: MessageCopyEvent = {
	...event,
	destinationMailboxId: "src-mbx",
	destinationMailboxPath: "INBOX",
} as MessageCopyEvent;

const called = (method: string): Call[] =>
	h.calls.filter((c) => c.method === method);

describe("handleMessageCopy", () => {
	beforeEach(() => {
		h = fresh();
	});

	it("writes the new UID, marks the copy synced, and updates the thread row", async () => {
		await handleMessageCopy(event, noopLog, 1, deps());

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
		assert.equal(
			(statusUpdate?.args[1] as { status?: string })?.status,
			"active",
			"the handler writes both status and syncStatus",
		);
		assert.equal(called("threadMessage.update").length, 1);
		// The FULL shape: `set` carries the new values, `composites` the CURRENT
		// row — new values in `composites` make ElectroDB's conditional check
		// fail and the update silently drop (the #186 bug class).
		assert.deepEqual(called("threadMessage.update")[0]?.args[2], { uid: 20 });
		assert.deepEqual(called("threadMessage.update")[0]?.args[3], {
			composites: {
				sentDate: 1,
				mailboxId: "src-mbx",
				isRead: false,
				isDeleted: false,
				hasStars: false,
				hasAttachment: false,
			},
		});
		assert.equal(h.disconnectCount, 1, "the scope is always disconnected");
	});

	// UIDPLUS is an extension: a server without it answers a perfectly
	// successful COPY with no COPYUID entry. An empty uidMap is therefore
	// UNCONFIRMED, and the destination is asked by Message-ID before any
	// verdict — the rule every sibling handler already carries. Issue #1097.
	describe("no COPYUID entry on the copy", () => {
		it("settles the row on the probed uid when the destination holds the message (non-UIDPLUS server, genuine success)", async () => {
			h.connection.copyMessages = async () => ({ uidMap: new Map() });
			h.destinationSearchUids = [77];

			await handleMessageCopy(event, noopLog, 1, deps());

			assert.deepEqual(called("message.get")[0]?.args, [["src-msg"]]);
			assert.deepEqual(called("message.updateUid")[0]?.args, [
				"new-msg",
				77,
				"dst-mbx",
			]);
			const statusUpdate = called("message.update")[0];
			assert.equal(
				(statusUpdate?.args[1] as { syncStatus?: string })?.syncStatus,
				"synced",
			);
			assert.deepEqual(called("threadMessage.update")[0]?.args[2], {
				uid: 77,
			});
			assert.equal(
				called("mailbox.update").length,
				0,
				"the probe bypasses the source's cursor guard — the destination's uidvalidity (2) differs from the source snapshot's (1), so a guarded probe would have tripped the mailbox",
			);
		});

		it("probes the DESTINATION mailbox, read-only, by Message-ID", async () => {
			h.connection.copyMessages = async () => ({ uidMap: new Map() });
			h.destinationSearchUids = [77];
			const opened: unknown[][] = [];
			h.connection.openBox = (async (...args: unknown[]) => {
				opened.push(args);
				return { uidvalidity: args[0] === "INBOX" ? 1 : 2 };
			}) as Connection["openBox"];

			await handleMessageCopy(event, noopLog, 1, deps());

			assert.deepEqual(
				opened,
				[
					["INBOX", true],
					["Archive", true],
				],
				"first delivery opens the source for the COPY first, then EXAMINEd the destination — the probe must never open a box writable, and never pre-probe before the COPY has run",
			);
			assert.equal(
				called("mailbox.update").length,
				0,
				"the destination EXAMINE goes through the RAW connection: the destination's uidvalidity (2) differs from the source snapshot's (1), so a probe through the guard would trip the mailbox",
			);
			assert.deepEqual(called("connection.search").at(-1)?.args[0], [
				["HEADER", "Message-ID", "<copied-message@example.com>"],
			]);
		});

		it("marks failed and rethrows when the probe finds nothing — unconfirmed, not proven failed", async () => {
			h.connection.copyMessages = async () => ({ uidMap: new Map() });
			h.destinationSearchUids = [];

			await assert.rejects(
				handleMessageCopy(event, noopLog, 1, deps()),
				/unconfirmed/,
			);

			assert.equal(called("message.updateUid").length, 0);
			assert.equal(called("threadMessage.update").length, 0);
			const update = called("message.update")[0];
			assert.equal(
				(update?.args[1] as { syncStatus?: string })?.syncStatus,
				"failed",
				"the unsettled marker is written while the retry is pending",
			);
			assert.equal(
				(update?.args[1] as { status?: string })?.status,
				undefined,
				"unconfirmed is never read as a server-side delete",
			);
		});

		it("does not probe when the source row carries no Message-ID header", async () => {
			h.connection.copyMessages = async () => ({ uidMap: new Map() });
			h.messageRow = {};

			await assert.rejects(
				handleMessageCopy(event, noopLog, 1, deps()),
				/unconfirmed/,
			);

			assert.equal(
				called("connection.search").length,
				0,
				"nothing to probe with",
			);
		});
	});

	// The budget mirrors the queue's redrive policy (`remit-message-mgmt`,
	// maxReceiveCount 3) so the handler resolves exhaustion exactly when the
	// queue would otherwise dead-letter.
	it("MESSAGE_COPY_MAX_ATTEMPTS falls back to the queue's maxReceiveCount when unset", () => {
		assert.equal(getMessageCopyMaxAttempts({}), 3);
		assert.equal(
			getMessageCopyMaxAttempts({ MESSAGE_COPY_MAX_ATTEMPTS: "3" }),
			3,
		);
		assert.equal(
			getMessageCopyMaxAttempts({ MESSAGE_COPY_MAX_ATTEMPTS: "5" }),
			5,
		);
		assert.equal(
			getMessageCopyMaxAttempts({ MESSAGE_COPY_MAX_ATTEMPTS: "nope" }),
			3,
		);
		assert.equal(
			getMessageCopyMaxAttempts({ MESSAGE_COPY_MAX_ATTEMPTS: "0" }),
			3,
		);
	});

	it("MESSAGE_COPY_MAX_ATTEMPTS is a concrete, positive number at module load", () => {
		assert.ok(MESSAGE_COPY_MAX_ATTEMPTS > 0);
	});

	// A copy onto its own source is rejected at enqueue; an event already in
	// flight must never have its copy row settled on the source's OWN uid. The
	// probe would open the still-selected source (imapflow re-open idempotency)
	// and match the source message itself (review of #1102).
	describe("same source and destination mailbox", () => {
		it("never probes and stays unconfirmed when the server names no COPYUID", async () => {
			h.connection.copyMessages = async () => ({ uidMap: new Map() });
			h.destinationSearchUids = [10]; // the source's own uid — what a broken probe would settle on

			await assert.rejects(
				handleMessageCopy(sameMailboxEvent, noopLog, 1, deps()),
				/unconfirmed/,
			);

			assert.equal(
				called("connection.search").length,
				0,
				"the source itself must never be probed as the copy",
			);
			assert.equal(called("message.updateUid").length, 0);
			assert.equal(called("threadMessage.update").length, 0);
			const update = called("message.update")[0];
			assert.equal(
				(update?.args[1] as { syncStatus?: string })?.syncStatus,
				"failed",
			);
		});

		it("still settles on a COPYUID entry — the same-mailbox copy really is a new uid", async () => {
			await handleMessageCopy(sameMailboxEvent, noopLog, 1, deps());

			assert.deepEqual(called("message.updateUid")[0]?.args, [
				"new-msg",
				20,
				"src-mbx",
			]);
		});
	});

	// The handler is idempotent in the DB but not on the wire: an unguarded
	// retry re-issued COPY after COPY, duplicating the message server-side on
	// every redelivery (review of #1102).
	describe("redelivery (receiveCount > 1)", () => {
		it("settles on a probe match without re-issuing COPY — an earlier attempt landed the copy", async () => {
			h.connection.copyMessages = async () => {
				throw new Error(
					"copyMessages must not be re-issued when the probe settles the copy",
				);
			};
			h.destinationSearchUids = [77];
			const opened: unknown[][] = [];
			h.connection.openBox = (async (...args: unknown[]) => {
				opened.push(args);
				return { uidvalidity: args[0] === "INBOX" ? 1 : 2 };
			}) as Connection["openBox"];

			await handleMessageCopy(event, noopLog, 2, deps());

			assert.deepEqual(
				opened,
				[["Archive", true]],
				"only the destination is EXAMINEd — a settled retry never opens the source",
			);
			assert.deepEqual(called("message.updateUid")[0]?.args, [
				"new-msg",
				77,
				"dst-mbx",
			]);
			const statusUpdate = called("message.update")[0];
			assert.equal(
				(statusUpdate?.args[1] as { syncStatus?: string })?.syncStatus,
				"synced",
			);
			assert.equal(
				(statusUpdate?.args[1] as { status?: string })?.status,
				"active",
			);
		});

		it("issues the COPY when the probe finds no earlier copy", async () => {
			h.destinationSearchUids = [];
			let copies = 0;
			h.connection.copyMessages = async () => {
				copies += 1;
				return { uidMap: new Map([[10, 20]]) };
			};

			await handleMessageCopy(event, noopLog, 2, deps());

			assert.equal(copies, 1, "the COPY is issued exactly once");
			assert.deepEqual(called("message.updateUid")[0]?.args, [
				"new-msg",
				20,
				"dst-mbx",
			]);
		});

		it("never pre-probes a same-mailbox copy on retry either", async () => {
			h.connection.copyMessages = async () => ({ uidMap: new Map() });
			h.destinationSearchUids = [10];

			await assert.rejects(
				handleMessageCopy(sameMailboxEvent, noopLog, 2, deps()),
				/unconfirmed/,
			);

			assert.equal(called("connection.search").length, 0);
		});
	});

	// Issue #1270: resolve retry exhaustion into a terminal outcome instead of
	// dead-lettering blindly. There is no honest question left to ask the
	// server — an unconfirmable copy is precisely one the probes cannot see.
	describe("retry budget exhausted (receiveCount = MESSAGE_COPY_MAX_ATTEMPTS)", () => {
		it("acks terminally on an unconfirmed copy, leaving the row failed as the unsettled marker", async () => {
			h.connection.copyMessages = async () => ({ uidMap: new Map() });
			h.destinationSearchUids = [];

			await handleMessageCopy(
				event,
				noopLog,
				MESSAGE_COPY_MAX_ATTEMPTS,
				deps(),
			);

			const update = called("message.update")[0];
			assert.equal(
				(update?.args[1] as { syncStatus?: string })?.syncStatus,
				"failed",
			);
			assert.equal(
				(update?.args[1] as { status?: string })?.status,
				undefined,
				"unconfirmed is never read as a server-side delete",
			);
			assert.equal(called("message.updateUid").length, 0);
			assert.equal(h.disconnectCount, 1, "the scope is still disconnected");
		});

		it("acks terminally on an unclassified IMAP error", async () => {
			h.connection.copyMessages = async () => {
				throw new Error("server exploded");
			};

			await handleMessageCopy(
				event,
				noopLog,
				MESSAGE_COPY_MAX_ATTEMPTS,
				deps(),
			);

			const update = called("message.update")[0];
			assert.equal(
				(update?.args[1] as { syncStatus?: string })?.syncStatus,
				"failed",
			);
		});

		it("still creates the destination and rethrows on TRYCREATE past the budget", async () => {
			h.connection.copyMessages = async () => {
				throw new Error("TRYCREATE: mailbox does not exist");
			};

			await assert.rejects(
				handleMessageCopy(event, noopLog, MESSAGE_COPY_MAX_ATTEMPTS, deps()),
				/TRYCREATE/,
			);

			assert.equal(called("createMailbox")[0]?.args[0], "Archive");
		});

		it("still marks the copy deleted when the source is gone on the server", async () => {
			h.connection.copyMessages = async () => {
				throw new Error("NONEXISTENT source message");
			};

			await handleMessageCopy(
				event,
				noopLog,
				MESSAGE_COPY_MAX_ATTEMPTS,
				deps(),
			);

			const update = called("message.update")[0];
			assert.equal((update?.args[1] as { status?: string })?.status, "deleted");
		});
	});

	it("returns early without connecting when the account is soft-deleted", async () => {
		h.account = {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			deletedAt: Date.now(),
		};

		await handleMessageCopy(event, noopLog, 1, deps());

		assert.equal(h.getConnectionCount, 0);
	});

	it("throws when the account no longer exists", async () => {
		h.account = null;

		await assert.rejects(
			handleMessageCopy(event, noopLog, 1, deps()),
			/not found/,
		);
	});

	it("acks terminally without connecting when the source mailbox was deleted", async () => {
		h.mailboxError = notFoundError();

		await handleMessageCopy(event, noopLog, 1, deps());

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

		await handleMessageCopy(event, noopLog, 1, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("message.updateUid").length, 0);
	});

	it("pauses quietly when openBox trips a UIDVALIDITY mismatch", async () => {
		h.connection.openBox = async () => ({ uidvalidity: 999 });

		await handleMessageCopy(event, noopLog, 1, deps());

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
			handleMessageCopy(event, noopLog, 1, deps()),
			/TRYCREATE/,
		);

		assert.equal(called("createMailbox")[0]?.args[0], "Archive");
		assert.equal(h.getConnectionCount, 2, "reconnects to create the mailbox");
	});

	it("marks the copy deleted-and-failed when the source is gone on the server", async () => {
		h.connection.copyMessages = async () => {
			throw new Error("NONEXISTENT source message");
		};

		await handleMessageCopy(event, noopLog, 1, deps());

		const update = called("message.update")[0];
		assert.equal((update?.args[1] as { status?: string })?.status, "deleted");
		assert.equal(called("createMailbox").length, 0);
	});

	it("marks failed and rethrows on an unclassified IMAP error", async () => {
		h.connection.copyMessages = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			handleMessageCopy(event, noopLog, 1, deps()),
			/server exploded/,
		);

		const update = called("message.update")[0];
		assert.equal(
			(update?.args[1] as { syncStatus?: string })?.syncStatus,
			"failed",
		);
	});
});
