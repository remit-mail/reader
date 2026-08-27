import assert from "node:assert";
import { beforeEach, describe, it, mock } from "node:test";
import type { ThreadMessageItem } from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import { renderMetrics, resetMetrics } from "@remit/logger-lambda";
import type { MessageDeleteEvent } from "../events.js";
import {
	buildThreadMessageTrashUpdate,
	buildThreadMessageUndelete,
	deleteAllThreadMessagesForMessage,
	getMessageDeleteMaxAttempts,
	handleMessageDelete,
	MESSAGE_DELETE_MAX_ATTEMPTS,
	type MessageDeleteDeps,
} from "./message-delete.js";

describe("getMessageDeleteMaxAttempts — env-derived threshold (#980)", () => {
	it("parses the injected env var", () => {
		assert.equal(
			getMessageDeleteMaxAttempts({ MESSAGE_DELETE_MAX_ATTEMPTS: "3" }),
			3,
		);
		assert.equal(
			getMessageDeleteMaxAttempts({ MESSAGE_DELETE_MAX_ATTEMPTS: "5" }),
			5,
		);
	});

	it("defaults to the mailbox queue's own maxReceiveCount when unset", () => {
		assert.equal(getMessageDeleteMaxAttempts({}), 3);
	});

	it("defaults on a non-numeric or non-positive value", () => {
		assert.equal(
			getMessageDeleteMaxAttempts({ MESSAGE_DELETE_MAX_ATTEMPTS: "nope" }),
			3,
		);
		assert.equal(
			getMessageDeleteMaxAttempts({ MESSAGE_DELETE_MAX_ATTEMPTS: "0" }),
			3,
		);
	});

	it("MESSAGE_DELETE_MAX_ATTEMPTS is a concrete, positive number at module load", () => {
		assert.ok(MESSAGE_DELETE_MAX_ATTEMPTS > 0);
	});
});

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

describe("buildThreadMessageUndelete", () => {
	// Every `set` payload here is hand-written, so the three builders can drift
	// apart silently. Undelete is the exact inverse of the trash update's
	// deletion mark, and it must move nothing else: the mail is still in Trash
	// at the uid the row already carries.

	it("clears only the deletion mark that buildThreadMessageTrashUpdate set", () => {
		const trashed = buildThreadMessageTrashUpdate(
			baseThreadMessage,
			42,
			trashMailboxId,
		);
		const undelete = buildThreadMessageUndelete(baseThreadMessage);

		assert.strictEqual(trashed.set.isDeleted, true);
		assert.strictEqual(undelete.set.isDeleted, false);
		assert.deepStrictEqual(
			Object.keys(undelete.set),
			["isDeleted"],
			"undelete must not move the row's uid or mailbox",
		);
	});

	it("carries the CURRENT row state in composites, like every other builder", () => {
		const undelete = buildThreadMessageUndelete(baseThreadMessage);

		assert.deepStrictEqual(
			undelete.composites,
			buildThreadMessageTrashUpdate(baseThreadMessage, 42, trashMailboxId)
				.composites,
		);
		assert.strictEqual(
			undelete.composites.isDeleted,
			baseThreadMessage.isDeleted,
			"composites hold the state to check against, never the new value",
		);
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
	fetchMessages: (uids: number[]) => Promise<{ uid: number }[]>;
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
	connection: Connection;
	threadMessageUpdateError?: Error;
	messageRow: { messageIdHeader?: string } | undefined;
	destinationSearchUids: number[];
	threadMessage: Record<string, unknown> | null;
	allThreadMessages: Record<string, unknown>[];
	getConnectionCount: number;
	disconnectCount: number;
}

let h: Harness;

const record =
	(method: string) =>
	async (...args: unknown[]) => {
		h.calls.push({ method, args });
	};

const MESSAGE_ID_HEADER = "<trashed-message@example.com>";

// The source-presence probe (`isMessageGoneFromOpenMailbox`) and the
// destination probe both go through `connection.search`; only the criterion
// form tells them apart.
const isMessageIdSearch = (criteria: unknown): boolean =>
	Array.isArray(criteria) &&
	Array.isArray(criteria[0]) &&
	criteria[0][0] === "HEADER";

const buildConnection = (): Connection => ({
	openBox: async () => ({ uidvalidity: 1 }),
	moveMessages: async () => ({ uidMap: new Map([[10, 20]]) }),
	deleteMessages: record(
		"connection.deleteMessages",
	) as Connection["deleteMessages"],
	createMailbox: record(
		"connection.createMailbox",
	) as Connection["createMailbox"],
	// The source box still holds the uid unless a case says otherwise, so the
	// presence probe only reports "gone" where a test made it true.
	fetchMessages: async (uids: number[]) => uids.map((uid) => ({ uid })),
	search: async (...args: unknown[]) => {
		h.calls.push({ method: "connection.search", args });
		return isMessageIdSearch(args[0]) ? h.destinationSearchUids : [10];
	},
});

const sourceNoLongerHoldsTheUid = (): void => {
	h.connection.fetchMessages = async () => [];
	h.connection.search = async (...args: unknown[]) => {
		h.calls.push({ method: "connection.search", args });
		return isMessageIdSearch(args[0]) ? h.destinationSearchUids : [];
	};
};

const fresh = (): Harness => ({
	calls: [],
	account: { accountId: "acc-1", accountConfigId: "cfg-1" },
	mailbox: { mailboxId: "src-mbx", uidValidity: 1, cursorState: undefined },
	messageRow: { messageIdHeader: MESSAGE_ID_HEADER },
	destinationSearchUids: [],
	connection: buildConnection(),
	threadMessage: {
		...baseThreadMessage,
		accountConfigId: "cfg-1",
		threadMessageId: "tm-1",
	},
	allThreadMessages: [
		{ ...baseThreadMessage, accountConfigId: "cfg-1", threadMessageId: "tm-1" },
		{ ...baseThreadMessage, accountConfigId: "cfg-1", threadMessageId: "tm-2" },
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
				get: async (messageIds: string[]) => {
					h.calls.push({ method: "message.get", args: [messageIds] });
					return h.messageRow ? [h.messageRow] : [];
				},
				updateUid: record("message.updateUid"),
				update: record("message.update"),
				delete: record("message.delete"),
			},
			threadMessage: {
				findByMessageId: async () => h.threadMessage,
				findAllByMessageId: async () => h.allThreadMessages,
				update: async (...args: unknown[]) => {
					h.calls.push({ method: "threadMessage.update", args });
					if (h.threadMessageUpdateError) throw h.threadMessageUpdateError;
				},
				delete: record("threadMessage.delete"),
				deleteMany: record("threadMessage.deleteMany"),
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
		emitEvent: record("emitEvent"),
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
	schemaVersion: 2,
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
	schemaVersion: 2,
	accountId: "acc-1",
	messageId: "msg-1",
	mailboxId: "src-mbx",
	mailboxPath: "INBOX",
	uid: 10,
	operation: "permanent_delete",
} as MessageDeleteEvent;

const called = (method: string): Call[] =>
	h.calls.filter((c) => c.method === method);

// Label order in the rendered text is prom-client's, not ours.
const imapFailures = async (operation: string): Promise<number> => {
	const line = (await renderMetrics())
		.split("\n")
		.find(
			(candidate) =>
				candidate.startsWith("remit_imap_failures_total{") &&
				candidate.includes(`operation="${operation}"`),
		);
	return line ? Number(line.slice(line.lastIndexOf(" ") + 1)) : 0;
};

describe("handleMessageDelete", () => {
	beforeEach(() => {
		h = fresh();
		resetMetrics();
	});

	it("moves to trash, rewrites the uid, and flips the thread row to deleted", async () => {
		await handleMessageDelete(moveEvent, noopLog, 1, deps());

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

	// UIDPLUS is an extension: a server without it answers a perfectly
	// successful MOVE with no COPYUID entry. An empty uidMap is therefore
	// UNCONFIRMED, and the destination is asked by Message-ID before any
	// verdict — the rule every sibling handler already carries. Issue #979.
	describe("no COPYUID entry on the move to trash", () => {
		it("settles the row on the probed uid when the message left the source and is at the destination (non-UIDPLUS server, genuine success)", async () => {
			h.connection.moveMessages = async () => ({ uidMap: new Map() });
			sourceNoLongerHoldsTheUid();
			h.destinationSearchUids = [77];

			await handleMessageDelete(moveEvent, noopLog, 1, deps());

			assert.deepEqual(called("message.updateUid")[0]?.args, [
				"msg-1",
				77,
				"trash-mbx",
			]);
			assert.deepEqual(called("threadMessage.update")[0]?.args[2], {
				uid: 77,
				mailboxId: "trash-mbx",
				isDeleted: true,
			});
			assert.equal(
				called("message.update").length,
				0,
				"a settled move never marks the row failed",
			);
		});

		it("probes the DESTINATION mailbox, read-only, by Message-ID", async () => {
			h.connection.moveMessages = async () => ({ uidMap: new Map() });
			sourceNoLongerHoldsTheUid();
			h.destinationSearchUids = [77];
			const opened: unknown[][] = [];
			h.connection.openBox = (async (...args: unknown[]) => {
				opened.push(args);
				return { uidvalidity: 1 };
			}) as Connection["openBox"];

			await handleMessageDelete(moveEvent, noopLog, 1, deps());

			assert.deepEqual(
				opened,
				[
					["INBOX", false],
					["INBOX", true],
					["Trash", true],
				],
				"the source is re-asked read-only, then the destination is EXAMINEd — neither probe may SELECT a box writable",
			);
			assert.deepEqual(called("connection.search").at(-1)?.args[0], [
				["HEADER", "Message-ID", MESSAGE_ID_HEADER],
			]);
		});

		// Issue #980. Within the budget the row is marked unsettled and the
		// event is re-thrown so the queue redelivers it, exactly as
		// `handleMessageMove` does; nothing is reverted and nothing is deleted,
		// because a MOVE that ran server-side but dropped before the tagged OK
		// is indistinguishable from one that never ran (#655, PR #652).
		it("throws to redeliver while the budget still has attempts left", async () => {
			h.connection.moveMessages = async () => ({ uidMap: new Map() });
			sourceNoLongerHoldsTheUid();
			h.destinationSearchUids = [];

			await assert.rejects(
				handleMessageDelete(moveEvent, noopLog, 1, deps()),
				/unconfirmed/,
			);

			assert.equal(called("message.updateUid").length, 0);
			assert.equal(
				called("message.delete").length,
				0,
				"an unconfirmed move must never delete the local row inside the budget",
			);
			assert.equal(
				called("threadMessage.deleteMany").length,
				0,
				"an unconfirmed move must never delete the listing rows inside the budget",
			);
			assert.equal(
				called("threadMessage.update").length,
				0,
				"an unconfirmed move must never revert the listing row to the source",
			);
			assert.equal(
				(called("message.update")[0]?.args[1] as { syncStatus?: string })
					?.syncStatus,
				"failed",
			);
			assert.equal(h.disconnectCount, 1);
		});

		it("settles once at the ceiling: reconciles the stale rows and resyncs both folders", async () => {
			h.connection.moveMessages = async () => ({ uidMap: new Map() });
			sourceNoLongerHoldsTheUid();
			h.destinationSearchUids = [];

			await handleMessageDelete(moveEvent, noopLog, 3, deps());

			assert.equal(
				called("threadMessage.deleteMany").length,
				1,
				"the ceiling settles the row rather than leaving it claiming a uid the server does not have",
			);
			assert.equal(called("message.delete").length, 1);
			assert.deepEqual(
				called("emitEvent").map((c) => c.args[0]),
				[
					{ type: "SYNC_MESSAGES", accountId: "acc-1", mailboxId: "src-mbx" },
					{ type: "SYNC_MESSAGES", accountId: "acc-1", mailboxId: "trash-mbx" },
				],
				"both folders re-project from IMAP so the message reappears where it actually is",
			);
			assert.equal(h.disconnectCount, 1);
		});

		// A message with no Message-ID header on a non-UIDPLUS server can never
		// be confirmed at the destination, so redelivering it only burns the
		// budget on an answer that cannot change.
		it("settles on the first attempt when the row carries no Message-ID header", async () => {
			h.connection.moveMessages = async () => ({ uidMap: new Map() });
			sourceNoLongerHoldsTheUid();
			h.messageRow = {};

			await handleMessageDelete(moveEvent, noopLog, 1, deps());

			assert.equal(
				called("connection.search").filter((c) =>
					JSON.stringify(c.args).includes("HEADER"),
				).length,
				0,
			);
			assert.equal(called("message.updateUid").length, 0);
			assert.equal(
				called("message.delete").length,
				1,
				"an unprobeable row settles instead of spending the whole budget",
			);
			assert.equal(called("emitEvent").length, 2);
			assert.equal(
				await imapFailures("MESSAGE_DELETE_TRASH_MOVE_UNCONFIRMED"),
				1,
			);
		});

		// The row this event names was already deleted, so there is nothing to
		// settle and nothing to show. Re-throwing would loop a NotFoundError on
		// the account's per-group FIFO and block every later mailbox event.
		it("acks without touching the database when the local row is already gone", async () => {
			h.connection.moveMessages = async () => ({ uidMap: new Map() });
			sourceNoLongerHoldsTheUid();
			h.messageRow = undefined;

			await handleMessageDelete(moveEvent, noopLog, 1, deps());

			assert.equal(called("message.update").length, 0);
			assert.equal(called("message.delete").length, 0);
			assert.equal(called("threadMessage.deleteMany").length, 0);
			assert.equal(called("emitEvent").length, 0);
		});

		// `searchMailboxByMessageId` returns the LOWEST matching uid, and one
		// Message-ID can have several server copies in one account while
		// `deriveMessageId` gives them one local row. A source that still holds
		// the uid proves the MOVE did not happen, so any hit at the destination
		// is a different copy.
		it("never takes a destination hit while the source still holds the uid (duplicate Message-ID)", async () => {
			h.connection.moveMessages = async () => ({ uidMap: new Map() });
			h.destinationSearchUids = [100];

			await assert.rejects(
				handleMessageDelete(moveEvent, noopLog, 1, deps()),
				/unconfirmed/,
			);

			assert.equal(
				called("message.updateUid").length,
				0,
				"an earlier copy's uid must never settle this row",
			);
			assert.equal(called("threadMessage.update").length, 0);
			assert.equal(called("message.delete").length, 0);
			assert.equal(
				(called("message.update")[0]?.args[1] as { syncStatus?: string })
					?.syncStatus,
				"failed",
			);
		});

		// A source that still holds the uid at the ceiling means the MOVE never
		// took effect. Local state is left exactly as it stands — the row is the
		// only record that this delete is still owed, and a revert races a MOVE
		// that may yet have landed (#652, #655).
		it("leaves a message still at its source untouched at the ceiling and never re-throws", async () => {
			h.connection.moveMessages = async () => ({ uidMap: new Map() });
			h.destinationSearchUids = [100];

			await handleMessageDelete(moveEvent, noopLog, 3, deps());

			assert.equal(called("message.delete").length, 0);
			assert.equal(called("threadMessage.deleteMany").length, 0);
			assert.equal(called("threadMessage.update").length, 0);

			// The row's mailbox and uid stay put, but `status` must leave
			// `moving`: `isPlacementUnsettled` reads exactly that value, so a row
			// left mid-mutation makes every later delete of this message wait on
			// a mutation that has already terminated.
			assert.deepEqual(called("message.update").at(-1)?.args[1], {
				status: "active",
				syncStatus: "failed",
			});
			assert.equal(await imapFailures("MESSAGE_DELETE_EXHAUSTED"), 1);
		});

		// The optimistic `updateForMove` already pointed the row at Trash. The
		// server has now confirmed the message never left the source, so the row
		// and the server disagree about where the mail is, and only a resync of
		// both folders settles that. Without it the user is shown the message in
		// Trash indefinitely while it sits in the source folder.
		it("resyncs both folders when the server confirms the message never left the source", async () => {
			h.connection.moveMessages = async () => ({ uidMap: new Map() });
			h.destinationSearchUids = [100];

			await handleMessageDelete(moveEvent, noopLog, 3, deps());

			assert.deepEqual(
				called("emitEvent").map((c) => c.args[0]),
				[
					{ type: "SYNC_MESSAGES", accountId: "acc-1", mailboxId: "src-mbx" },
					{ type: "SYNC_MESSAGES", accountId: "acc-1", mailboxId: "trash-mbx" },
				],
				"a confirmed divergence resyncs on the broken verdict too, not only on the reconciled one",
			);
		});

		// Issue #980, the failure the budget exists for: every redelivery
		// re-MOVEs a uid the source no longer holds and throws identically. The
		// ceiling lives in the error catch, so a throwing `moveMessages` settles
		// there rather than running past the budget into the dead-letter queue.
		describe("a re-MOVE that throws", () => {
			const moveThrows = (): void => {
				h.connection.moveMessages = async () => {
					throw new Error(
						"NO [TRYAGAIN] UID MOVE failed: no matching messages",
					);
				};
			};

			it("re-throws inside the budget so the queue redelivers", async () => {
				moveThrows();

				await assert.rejects(
					handleMessageDelete(moveEvent, noopLog, 1, deps()),
					/UID MOVE failed/,
				);

				assert.equal(called("message.delete").length, 0);
				assert.equal(called("threadMessage.deleteMany").length, 0);
				assert.equal(
					(called("message.update")[0]?.args[1] as { syncStatus?: string })
						?.syncStatus,
					"failed",
				);
			});

			it("settles at the ceiling instead of dead-lettering undiagnosed", async () => {
				moveThrows();
				sourceNoLongerHoldsTheUid();

				await handleMessageDelete(moveEvent, noopLog, 3, deps());

				assert.equal(
					called("threadMessage.deleteMany").length,
					1,
					"the ceiling must diagnose the failure, not hand it to the DLQ",
				);
				assert.equal(called("message.delete").length, 1);
				assert.equal(called("emitEvent").length, 2);
			});

			it("settles a still-present message at the ceiling out of `moving`", async () => {
				moveThrows();

				await handleMessageDelete(moveEvent, noopLog, 3, deps());

				assert.deepEqual(called("message.update").at(-1)?.args[1], {
					status: "active",
					syncStatus: "failed",
				});
				assert.equal(await imapFailures("MESSAGE_DELETE_EXHAUSTED"), 1);
			});
		});

		// A probe the server refused says nothing either way, so it counts as
		// unconfirmed and spends an attempt. The budget is what makes that safe:
		// without a ceiling the redeliveries would re-MOVE a uid the source no
		// longer holds forever and head-of-line block the account's deletes.
		it("treats an unanswerable probe as unconfirmed and spends an attempt", async () => {
			h.connection.moveMessages = async () => ({ uidMap: new Map() });
			h.connection.openBox = (async (_path: string, readOnly?: boolean) => {
				if (readOnly) throw new Error("NO [SERVERBUG] EXAMINE failed");
				return { uidvalidity: 1 };
			}) as Connection["openBox"];

			await assert.rejects(
				handleMessageDelete(moveEvent, noopLog, 1, deps()),
				/unconfirmed/,
			);

			assert.equal(called("message.updateUid").length, 0);
			assert.equal(called("message.delete").length, 0);
			assert.equal(called("threadMessage.deleteMany").length, 0);
			assert.equal(called("threadMessage.update").length, 0);
			assert.equal(
				(called("message.update")[0]?.args[1] as { syncStatus?: string })
					?.syncStatus,
				"failed",
			);
			assert.equal(h.disconnectCount, 1);
		});
	});

	// The queue handler `JSON.parse`s the body and casts it to WorkerEvent with
	// no validation, so an event whose `operation` is missing, misspelled or
	// from a newer producer reaches here. It must never be read as an expunge.
	for (const [name, operation] of [
		["missing", undefined],
		["unknown", "trash"],
		["empty", ""],
	] as const) {
		it(`abandons the delete and hands the row back when operation is ${name}`, async () => {
			const malformed = {
				...moveEvent,
				operation,
			} as unknown as MessageDeleteEvent;

			await handleMessageDelete(malformed, noopLog, 1, deps());

			assert.equal(
				called("connection.deleteMessages").length,
				0,
				"nothing may be expunged for an operation nobody wrote",
			);
			assert.equal(called("message.delete").length, 0);
			assert.equal(called("threadMessage.delete").length, 0);

			// The row goes back to the mailbox the server still holds it in, so
			// the failure is visible as the message reappearing rather than as an
			// invisible syncStatus on a row that claims Trash.
			assert.deepEqual(called("message.updateUid")[0]?.args, [
				"msg-1",
				10,
				"src-mbx",
			]);
			assert.deepEqual(called("message.update")[0]?.args[1], {
				status: "active",
				syncStatus: "failed",
			});
			assert.deepEqual(called("threadMessage.update")[0]?.args[2], {
				uid: 10,
				mailboxId: "src-mbx",
				isDeleted: false,
			});
		});
	}

	it("refuses to expunge a move-to-trash that names no destination", async () => {
		const destinationless = {
			...moveEvent,
			destinationMailboxId: undefined,
			destinationMailboxPath: undefined,
		} as MessageDeleteEvent;

		await handleMessageDelete(destinationless, noopLog, 1, deps());

		assert.equal(called("connection.deleteMessages").length, 0);
		assert.equal(called("message.delete").length, 0);
		assert.deepEqual(called("message.update")[0]?.args[1], {
			status: "active",
			syncStatus: "failed",
		});
	});

	it("expunges on the server and removes every thread row before the message row", async () => {
		await handleMessageDelete(permanentEvent, noopLog, 1, deps());

		assert.deepEqual(called("connection.deleteMessages")[0]?.args, [[10]]);
		assert.equal(called("threadMessage.delete").length, 2);
		assert.ok(
			h.calls.findIndex((c) => c.method === "threadMessage.delete") <
				h.calls.findIndex((c) => c.method === "message.delete"),
			"thread rows go first so no row outlives its message",
		);
	});

	// Regression on #212: a permanent delete the server has already applied must
	// still reconcile the local rows, now that the text alone no longer decides.
	it("cleans up locally and swallows the error when the message is confirmed gone on IMAP", async () => {
		h.connection.deleteMessages = async () => {
			throw new Error("NONEXISTENT uid");
		};
		sourceNoLongerHoldsTheUid();

		await handleMessageDelete(permanentEvent, noopLog, 1, deps());

		assert.equal(called("message.delete").length, 1);
		assert.equal(called("threadMessage.delete").length, 2);
	});

	// Issue #845. The three cases below are the same bug from three directions:
	// "not found" in an error string is never on its own a reason to destroy the
	// only local record of live mail.

	it("keeps the rows when a move-to-trash fails after the MOVE landed", async () => {
		// The MOVE succeeded; the ThreadMessage write behind it did not. The
		// message is sitting in Trash, and the NotFoundError names a local row,
		// not a mail-server one.
		h.threadMessageUpdateError = Object.assign(
			new Error("Thread message not found"),
			{ name: "NotFoundError" },
		);
		sourceNoLongerHoldsTheUid();

		await assert.rejects(
			handleMessageDelete(moveEvent, noopLog, 1, deps()),
			/not found/,
		);

		assert.equal(
			called("message.delete").length,
			0,
			"the message is in Trash; deleting its row loses the only handle on it",
		);
		assert.equal(called("threadMessage.delete").length, 0);
		assert.equal(
			called("connection.search").length,
			0,
			"a move-to-trash never probes: absence from the source is its success signature",
		);
		assert.equal(
			(called("message.update")[0]?.args[1] as { syncStatus?: string })
				?.syncStatus,
			"failed",
		);
	});

	it("keeps the rows on a NONEXISTENT move-to-trash whose source still holds the uid", async () => {
		h.connection.moveMessages = async () => {
			throw new Error("NONEXISTENT: mailbox does not exist");
		};

		await assert.rejects(
			handleMessageDelete(moveEvent, noopLog, 1, deps()),
			/NONEXISTENT/,
		);

		assert.equal(called("message.delete").length, 0);
		assert.equal(called("threadMessage.delete").length, 0);
		assert.equal(
			(called("message.update")[0]?.args[1] as { syncStatus?: string })
				?.syncStatus,
			"failed",
		);
	});

	it("keeps the rows when a permanent delete's source still holds the uid", async () => {
		h.connection.deleteMessages = async () => {
			throw new Error("NONEXISTENT uid");
		};
		// imapflow drops rows on back-to-back FETCHes (#408); the SEARCH is what
		// the verdict rests on, and it still lists the uid.
		h.connection.fetchMessages = async () => [];

		await assert.rejects(
			handleMessageDelete(permanentEvent, noopLog, 1, deps()),
			/NONEXISTENT/,
		);

		assert.equal(
			called("connection.search").length,
			1,
			"the error text only selects a candidate; the source box decides",
		);
		assert.equal(called("message.delete").length, 0);
		assert.equal(called("threadMessage.delete").length, 0);
	});

	it("keeps the rows and rethrows the original error when the probe cannot answer", async () => {
		// The SELECT is what failed, so there is no open box left for the probe
		// to ask. The IMAP error must still be the one that rejects, and the row
		// must not be stranded mid-delete for the record to carry to the DLQ.
		h.connection.openBox = async () => {
			throw new Error("NONEXISTENT mailbox does not exist");
		};
		h.connection.fetchMessages = async () => {
			throw new Error("No mailbox selected");
		};

		await assert.rejects(
			handleMessageDelete(permanentEvent, noopLog, 1, deps()),
			/NONEXISTENT mailbox does not exist/,
		);

		assert.equal(called("message.delete").length, 0);
		assert.equal(called("threadMessage.delete").length, 0);
		assert.equal(
			(called("message.update")[0]?.args[1] as { syncStatus?: string })
				?.syncStatus,
			"failed",
		);
	});

	it("abandons rather than creating the destination on TRYCREATE", async () => {
		// Creating it resurrects an empty `Trash` beside the real one, and the
		// name-hint rule then has two folders to choose between. The picker
		// offers the ones the account actually has.
		h.connection.moveMessages = async () => {
			throw new Error("TRYCREATE: no such mailbox");
		};

		await handleMessageDelete(moveEvent, noopLog, 1, deps());

		assert.equal(called("connection.createMailbox").length, 0);
		assert.deepEqual(called("message.updateUid")[0]?.args, [
			"msg-1",
			10,
			"src-mbx",
		]);
		assert.deepEqual(called("message.update")[0]?.args[1], {
			status: "active",
			syncStatus: "failed",
		});
		assert.deepEqual(called("threadMessage.update")[0]?.args[2], {
			uid: 10,
			mailboxId: "src-mbx",
			isDeleted: false,
		});
	});

	it("abandons an event minted under an unknown contract, before connecting", async () => {
		const unversioned = {
			...moveEvent,
			schemaVersion: undefined,
		} as unknown as MessageDeleteEvent;

		await handleMessageDelete(unversioned, noopLog, 1, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("connection.deleteMessages").length, 0);
		assert.deepEqual(called("message.updateUid")[0]?.args, [
			"msg-1",
			10,
			"src-mbx",
		]);
		assert.deepEqual(called("threadMessage.update")[0]?.args[2], {
			uid: 10,
			mailboxId: "src-mbx",
			isDeleted: false,
		});
	});

	it("hands back every listing row a message has, not just the first", async () => {
		const unversioned = {
			...moveEvent,
			schemaVersion: undefined,
		} as unknown as MessageDeleteEvent;

		await handleMessageDelete(unversioned, noopLog, 1, deps());

		assert.deepEqual(
			called("threadMessage.update").map((c) => c.args[1]),
			["tm-1", "tm-2"],
		);
	});

	it("finishes the removal when an abandoned delete has no listing rows left", async () => {
		// A permanent delete removes them before it enqueues, and they cannot be
		// rebuilt here. Restoring the Message alone leaves mail nothing can list,
		// which is worse than either consistent state; the server copy survives
		// and a full sync brings it back.
		h.allThreadMessages = [];
		const unversioned = {
			...permanentEvent,
			schemaVersion: undefined,
		} as unknown as MessageDeleteEvent;

		await handleMessageDelete(unversioned, noopLog, 1, deps());

		assert.equal(called("connection.deleteMessages").length, 0);
		assert.deepEqual(called("message.delete")[0]?.args, ["msg-1"]);
		assert.equal(
			called("message.update").length,
			0,
			"never leave a Message row no listing can reach",
		);
	});

	it("marks failed and rethrows on an unclassified IMAP error", async () => {
		h.connection.moveMessages = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			handleMessageDelete(moveEvent, noopLog, 1, deps()),
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

		await handleMessageDelete(moveEvent, noopLog, 1, deps());

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

		await handleMessageDelete(moveEvent, noopLog, 1, deps());

		assert.equal(h.getConnectionCount, 0);
	});

	it("acks terminally without connecting when the mailbox was deleted", async () => {
		h.mailboxError = Object.assign(new Error("Mailbox not found: src-mbx"), {
			name: "NotFoundError",
		});

		await handleMessageDelete(moveEvent, noopLog, 1, deps());

		assert.equal(h.getConnectionCount, 0);
		assert.equal(called("message.updateUid").length, 0);
		assert.equal(called("message.delete").length, 0);
	});

	it("returns early without connecting when the account is soft-deleted", async () => {
		h.account = {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			deletedAt: Date.now(),
		};

		await handleMessageDelete(moveEvent, noopLog, 1, deps());

		assert.equal(h.getConnectionCount, 0);
	});

	it("throws when the account no longer exists", async () => {
		h.account = null;

		await assert.rejects(
			handleMessageDelete(moveEvent, noopLog, 1, deps()),
			/not found/,
		);
	});
});
