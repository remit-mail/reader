import assert from "node:assert";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { getClient, type RemitClient, setClient } from "@remit/backend/client";
import type { AccountItem, ThreadMessageItem } from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import type { IImapConnection } from "@remit/mailbox-service";
import type { MessageMoveEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";
import {
	buildThreadMessageMoveUpdate,
	emitMoveResync,
	getMessageMoveMaxAttempts,
	handleMessageMove,
	MESSAGE_MOVE_MAX_ATTEMPTS,
	type MessageMoveDeps,
	moveThenResync,
	probePausedPlacement,
	searchMailboxForHighestMessageIdUid,
} from "./message-move.js";

const silentLogger = (() => {
	const noop = () => {};
	const log = {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => log,
	} as unknown as Logger;
	return log;
})();

const sourceMailboxId = "source-mailbox-id-aaaaaaaaa";
const destinationMailboxId = "destination-mailbox-aaaaa";

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

describe("buildThreadMessageMoveUpdate", () => {
	// Regression for the same composites-direction landmine PR #186 fixed in
	// `flag-queue.ts`. The CURRENT row state must go in `composites`; the NEW
	// values must go in `set`. Flipping any of these silently drops the
	// ThreadMessage local update on every IMAP MOVE — the row stays in the
	// source mailbox while the IMAP server thinks it moved.

	it("set carries the NEW uid, mailboxId, and isDeleted=false", () => {
		const args = buildThreadMessageMoveUpdate(
			baseThreadMessage,
			42,
			destinationMailboxId,
		);

		assert.strictEqual(args.set.uid, 42, "set.uid must be the NEW uid");
		assert.strictEqual(
			args.set.mailboxId,
			destinationMailboxId,
			"set.mailboxId must be the NEW destination mailbox",
		);
		assert.strictEqual(
			args.set.isDeleted,
			false,
			"set.isDeleted must be false (move is not a delete)",
		);
	});

	it("composites.mailboxId is the CURRENT (source) mailboxId, not the destination", () => {
		const args = buildThreadMessageMoveUpdate(
			baseThreadMessage,
			42,
			destinationMailboxId,
		);

		assert.strictEqual(
			args.composites.mailboxId,
			sourceMailboxId,
			"composites.mailboxId must be the CURRENT source mailbox; passing the destination breaks the conditional check",
		);
		assert.notStrictEqual(
			args.composites.mailboxId,
			destinationMailboxId,
			"composites.mailboxId must NOT match the new destinationMailboxId",
		);
	});

	it("composites.isDeleted is the CURRENT value, not the new false", () => {
		const args = buildThreadMessageMoveUpdate(
			{ ...baseThreadMessage, isDeleted: true },
			42,
			destinationMailboxId,
		);

		assert.strictEqual(
			args.composites.isDeleted,
			true,
			"composites.isDeleted must be the CURRENT value (true here), not the new value",
		);
	});

	it("composites mirrors every CURRENT indexed attribute on the threadMessage", () => {
		const tm = {
			sentDate: 1700000000123,
			mailboxId: sourceMailboxId,
			isRead: false,
			isDeleted: true,
			hasStars: true,
			hasAttachment: true,
		};

		const args = buildThreadMessageMoveUpdate(tm, 99, destinationMailboxId);

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

const accountId = "alice-account-aaaaaaaaaa";

describe("emitMoveResync (#1031)", () => {
	// A move shifts a message between two folders; both folders' counts must
	// refresh from IMAP via the existing per-folder SYNC_MESSAGES sync. Counts
	// are never mutated locally — only re-read downstream.

	it("emits SYNC_MESSAGES for both the source and destination folders", async () => {
		const emit = mock.fn(async () => undefined);

		await emitMoveResync(emit, {
			accountId,
			sourceMailboxId,
			destinationMailboxId,
		});

		assert.equal(emit.mock.calls.length, 2);
		assert.deepEqual(emit.mock.calls[0].arguments, [
			{ type: "SYNC_MESSAGES", accountId, mailboxId: sourceMailboxId },
		]);
		assert.deepEqual(emit.mock.calls[1].arguments, [
			{ type: "SYNC_MESSAGES", accountId, mailboxId: destinationMailboxId },
		]);
	});
});

describe("moveThenResync (#1031)", () => {
	it("runs the resync after the move resolves", async () => {
		const order: string[] = [];
		const performMove = mock.fn(async () => {
			order.push("move");
		});
		const resync = mock.fn(async () => {
			order.push("resync");
		});

		await moveThenResync(performMove, resync);

		assert.deepEqual(order, ["move", "resync"]);
		assert.equal(resync.mock.calls.length, 1);
	});

	it("does not resync when the move fails, and propagates the error", async () => {
		const performMove = mock.fn(async () => {
			throw new Error("IMAP move failed");
		});
		const resync = mock.fn(async () => undefined);

		await assert.rejects(
			() => moveThenResync(performMove, resync),
			/IMAP move failed/,
		);

		assert.equal(resync.mock.calls.length, 0);
	});
});

describe("getMessageMoveMaxAttempts — env-derived threshold (#655)", () => {
	it("parses the injected env var", () => {
		assert.equal(
			getMessageMoveMaxAttempts({ MESSAGE_MOVE_MAX_ATTEMPTS: "3" }),
			3,
		);
		assert.equal(
			getMessageMoveMaxAttempts({ MESSAGE_MOVE_MAX_ATTEMPTS: "5" }),
			5,
		);
	});

	it("defaults to the message queue's own maxReceiveCount when unset", () => {
		assert.equal(getMessageMoveMaxAttempts({}), 3);
	});

	it("defaults on a non-numeric or non-positive value", () => {
		assert.equal(
			getMessageMoveMaxAttempts({ MESSAGE_MOVE_MAX_ATTEMPTS: "nope" }),
			3,
		);
		assert.equal(
			getMessageMoveMaxAttempts({ MESSAGE_MOVE_MAX_ATTEMPTS: "0" }),
			3,
		);
	});

	it("MESSAGE_MOVE_MAX_ATTEMPTS is a concrete, positive number at module load", () => {
		assert.ok(MESSAGE_MOVE_MAX_ATTEMPTS > 0);
	});
});

describe("handleMessageMove — the move's own pending state gates every attempt", () => {
	const acctId = "mm-acc-zzz";

	const cappedAccount = (): AccountItem =>
		({
			accountId: acctId,
			accountConfigId: "mm-cfg-zzz",
			connectionState: "authenticated",
			username: "mm@imap.example.com",
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			passwordHash: JSON.stringify({
				encryptedDek: "",
				encryptedData: "",
				iv: "",
				authTag: "",
			}),
		}) as unknown as AccountItem;

	const event: MessageMoveEvent = {
		type: "MESSAGE_MOVE",
		accountId: acctId,
		accountConfigId: "mm-cfg-zzz",
		messageId: "mm-msg-zzz",
		sourceMailboxId: "mm-src-zzz",
		sourceMailboxPath: "INBOX",
		destinationMailboxId: "mm-dst-zzz",
		destinationMailboxPath: "Archive",
		uid: 10,
		eventId: "mm-evt-zzz",
		timestamp: 1700000000000,
	} as MessageMoveEvent;

	const pendingRow = () => ({
		messageId: "mm-msg-zzz",
		mailboxId: "mm-dst-zzz",
		uid: 10,
		status: "moving",
		syncStatus: "pending",
	});

	// The client is supplied by injection (`setClient`), so these tests register
	// the repositories they then mock rather than reaching a composition.
	before(() => {
		setClient({
			account: { get: async () => undefined },
			mailbox: { get: async () => undefined },
			message: {
				get: async () => [],
				update: async () => undefined,
				updateUid: async () => undefined,
				updateForMove: async () => undefined,
			},
			threadMessage: {
				findAllByMessageId: async () => [],
				findByMessageId: async () => undefined,
				update: async () => undefined,
			},
			secrets: { decrypt: async () => undefined },
		} as unknown as RemitClient);
	});

	let emitted: unknown[] = [];
	let connectCount = 0;

	// One folder's Message-ID SEARCH answers, keyed by the box last opened.
	// `openBox` on this handle is deliberately unguarded: the paused settle asks
	// on the identity axis, which a UIDVALIDITY change leaves intact.
	const holdingConnection = (
		holdings: Record<string, number[]>,
	): IImapConnection => {
		let opened = "";
		return {
			openBox: async (path: string) => {
				opened = path;
				return {} as never;
			},
			search: async () => holdings[opened] ?? [],
		} as unknown as IImapConnection;
	};

	const moveDeps = (connection?: IImapConnection): MessageMoveDeps => ({
		getClient,
		buildLifecycleDeps,
		withOAuthLifecycle,
		createConnectionScope: () => ({
			getConnection: async () => {
				connectCount += 1;
				if (!connection) throw new Error("this case must not connect");
				return connection;
			},
			disconnect: async () => undefined,
		}),
		emitEvent: (async (event: unknown) => {
			emitted.push(event);
		}) as MessageMoveDeps["emitEvent"],
	});

	const pausedSource = () => ({
		mailboxId: "mm-src-zzz",
		uidValidity: 1,
		cursorState: "rebuilding",
	});

	beforeEach(() => {
		emitted = [];
		connectCount = 0;
	});

	afterEach(() => mock.restoreAll());

	it("acks without connecting when the source mailbox was deleted", async () => {
		const client = await getClient();
		mock.method(client.account, "get", async () => cappedAccount());
		mock.method(client.secrets, "decrypt", async () => "fake-password");
		mock.method(client.message, "get", async () => [pendingRow()]);
		mock.method(client.mailbox, "get", async () => {
			throw Object.assign(new Error("Mailbox not found: mm-src-zzz"), {
				name: "NotFoundError",
			});
		});
		const updateUid = mock.method(client.message, "updateUid", async () => {});

		// Must resolve, not reject — a deleted source folder makes the move moot.
		await handleMessageMove(event, silentLogger);

		assert.equal(
			updateUid.mock.calls.length,
			0,
			"a deleted mailbox never reaches the IMAP move",
		);
	});

	// Without this gate a redelivery of an already-confirmed move re-runs the
	// MOVE against a UID the source no longer holds, and on exhaustion the
	// terminal resolver reads the source's honest "gone" as grounds to delete a
	// row that is correct and settled.
	it("acks without connecting when the move already settled", async () => {
		const client = await getClient();
		mock.method(client.account, "get", async () => cappedAccount());
		mock.method(client.secrets, "decrypt", async () => "fake-password");
		mock.method(client.message, "get", async () => [
			{ ...pendingRow(), uid: 4711, status: "active", syncStatus: "synced" },
		]);
		const mailboxGet = mock.method(client.mailbox, "get", async () => {
			throw new Error("a settled move must never resolve a mailbox");
		});
		const update = mock.method(client.message, "update", async () => {});

		await handleMessageMove(event, silentLogger, MESSAGE_MOVE_MAX_ATTEMPTS);

		assert.equal(mailboxGet.mock.calls.length, 0);
		assert.equal(
			update.mock.calls.length,
			0,
			"a settled row is never written again",
		);
	});

	const arrangePausedMove = async (): Promise<{
		updateForMoveCalls: unknown[][];
		updateUidCalls: unknown[][];
		threadUpdateCalls: unknown[][];
	}> => {
		const client = await getClient();
		mock.method(client.account, "get", async () => cappedAccount());
		mock.method(client.secrets, "decrypt", async () => "fake-password");
		mock.method(client.message, "get", async () => [
			{ ...pendingRow(), messageIdHeader: "<moved@example.com>" },
		]);
		mock.method(client.mailbox, "get", async () => pausedSource());
		const updateForMoveCalls: unknown[][] = [];
		mock.method(client.message, "updateForMove", async (...args: unknown[]) => {
			updateForMoveCalls.push(args);
		});
		const updateUidCalls: unknown[][] = [];
		mock.method(client.message, "updateUid", async (...args: unknown[]) => {
			updateUidCalls.push(args);
		});
		const threadRow = {
			...baseThreadMessage,
			accountConfigId: "mm-cfg-zzz",
			threadMessageId: "mm-tm-zzz",
			mailboxId: "mm-dst-zzz",
		};
		mock.method(client.threadMessage, "findAllByMessageId", async () => [
			threadRow,
		]);
		mock.method(client.threadMessage, "findByMessageId", async () => threadRow);
		const threadUpdateCalls: unknown[][] = [];
		mock.method(client.threadMessage, "update", async (...args: unknown[]) => {
			threadUpdateCalls.push(args);
		});
		return { updateForMoveCalls, updateUidCalls, threadUpdateCalls };
	};

	// Issue #1203. Acking a paused cursor left the row `moving` with `mailboxId`
	// on the destination and `uid` on the source. Nothing re-enqueues a
	// MESSAGE_MOVE, and the cursor rebuild matches rows by
	// `(accountConfigId, mailboxId)`, so a row naming the destination sits in
	// neither folder's set: `placementBindingOf` answered `in_flight` for good
	// and the message became unmovable and undeletable.
	it("hands the row back to its source on a first delivery, without connecting", async () => {
		const { updateForMoveCalls, threadUpdateCalls } = await arrangePausedMove();

		await handleMessageMove(event, silentLogger, 1, moveDeps());

		assert.equal(
			connectCount,
			0,
			"a first delivery has provably issued no MOVE, so it needs no answer from the server",
		);
		assert.deepEqual(
			updateForMoveCalls[0],
			[
				"mm-msg-zzz",
				{
					mailboxId: "mm-src-zzz",
					uid: 10,
					status: "active",
					syncStatus: "synced",
				},
			],
			"the row goes back to the source pair, which is the set the rebuild adjudicates",
		);
		assert.equal(
			(threadUpdateCalls[0]?.[2] as { mailboxId?: string })?.mailboxId,
			"mm-src-zzz",
			"the listing row follows the message back to its source folder",
		);
	});

	// A paused settle is a settle, so both folders re-read their counts from
	// IMAP — the same resync every other terminal verdict in this handler runs.
	// Without it the repair depended entirely on someone else arming the
	// mailbox's rebuild.
	it("resyncs both folders after a paused move settles", async () => {
		await arrangePausedMove();

		await handleMessageMove(event, silentLogger, 1, moveDeps());

		assert.deepEqual(emitted, [
			{ type: "SYNC_MESSAGES", accountId: acctId, mailboxId: "mm-src-zzz" },
			{ type: "SYNC_MESSAGES", accountId: acctId, mailboxId: "mm-dst-zzz" },
		]);
	});

	// Issue #1203, the redelivery half. Attempt 1's MOVE landed and its tagged
	// OK was lost with the connection; the cursor tripped meanwhile, so attempt
	// 2 is refused at the openBox guard. Handing the row back here writes
	// `synced` on INBOX for mail the server holds in Archive — a settled
	// placement on an inference, which is what `restoreSourcePlacement` forbids.
	it("settles a redelivered paused move onto the destination the server confirms", async () => {
		const { updateForMoveCalls, updateUidCalls, threadUpdateCalls } =
			await arrangePausedMove();

		await handleMessageMove(
			event,
			silentLogger,
			2,
			moveDeps(holdingConnection({ INBOX: [], Archive: [77] })),
		);

		assert.deepEqual(updateUidCalls[0], ["mm-msg-zzz", 77, "mm-dst-zzz"]);
		assert.equal(
			updateForMoveCalls.length,
			0,
			"the row must never be handed back to a folder the server has moved it out of",
		);
		assert.equal(
			(threadUpdateCalls[0]?.[2] as { uid?: number })?.uid,
			77,
			"the listing row takes the destination's own uid",
		);
	});

	// Issue #1122 on the same path. The destination already held an older copy
	// of this Message-ID and the MOVE never ran, so the destination hit is not
	// this message. The source is asked first for exactly that reason, and its
	// answer ends it.
	it("never binds a redelivered paused move to an older copy while the source still answers", async () => {
		const { updateForMoveCalls, updateUidCalls } = await arrangePausedMove();

		await handleMessageMove(
			event,
			silentLogger,
			2,
			moveDeps(holdingConnection({ INBOX: [4], Archive: [12] })),
		);

		assert.equal(updateUidCalls.length, 0);
		assert.deepEqual(updateForMoveCalls[0]?.[1], {
			mailboxId: "mm-src-zzz",
			uid: 10,
			status: "active",
			syncStatus: "synced",
		});
	});

	it("acks without connecting when the message row is already gone", async () => {
		const client = await getClient();
		mock.method(client.account, "get", async () => cappedAccount());
		mock.method(client.secrets, "decrypt", async () => "fake-password");
		mock.method(client.message, "get", async () => []);
		const mailboxGet = mock.method(client.mailbox, "get", async () => {
			throw new Error("a missing row must never resolve a mailbox");
		});

		await handleMessageMove(event, silentLogger, MESSAGE_MOVE_MAX_ATTEMPTS);

		assert.equal(mailboxGet.mock.calls.length, 0);
	});
});

describe("probePausedPlacement — which folder a paused mutation left the message in (#1203)", () => {
	const buildConnection = (
		holdings: Record<string, number[]>,
	): { connection: IImapConnection; opened: string[] } => {
		const opened: string[] = [];
		let current = "";
		return {
			opened,
			connection: {
				openBox: async (path: string) => {
					opened.push(path);
					current = path;
					return {} as never;
				},
				search: async () => holdings[current] ?? [],
			} as unknown as IImapConnection,
		};
	};

	const probe = (holdings: Record<string, number[]>) => {
		const { connection, opened } = buildConnection(holdings);
		return {
			opened,
			result: probePausedPlacement(connection, {
				messageIdHeader: "<paused@example.com>",
				sourceMailboxPath: "INBOX",
				destinationMailboxPath: "Archive",
			}),
		};
	};

	it("stops at the source and never asks the destination when the source still holds it", async () => {
		const { opened, result } = probe({ INBOX: [4], Archive: [12] });

		assert.deepStrictEqual(await result, { kind: "at-source" });
		assert.deepStrictEqual(
			opened,
			["INBOX"],
			"a source hit ends it: with the mutation unrun, every destination hit is an older copy (#1122)",
		);
	});

	it("answers the destination's highest matching uid once the source has let go", async () => {
		const { result } = probe({ INBOX: [], Archive: [12, 77] });

		assert.deepStrictEqual(await result, { kind: "at-destination", uid: 77 });
	});

	it("answers gone when neither folder holds it", async () => {
		assert.deepStrictEqual(await probe({}).result, { kind: "gone" });
	});

	it("answers gone, not at-source, when there is no destination to ask", async () => {
		const { connection, opened } = buildConnection({ INBOX: [] });

		assert.deepStrictEqual(
			await probePausedPlacement(connection, {
				messageIdHeader: "<paused@example.com>",
				sourceMailboxPath: "INBOX",
				destinationMailboxPath: undefined,
			}),
			{ kind: "gone" },
		);
		assert.deepStrictEqual(opened, ["INBOX"]);
	});

	// A row with no Message-ID header cannot be asked about, and the server's
	// silence is not an answer. `unprobeable` keeps that distinct from `gone`.
	it("asks nothing at all when the row carries no Message-ID header", async () => {
		const { connection, opened } = buildConnection({ INBOX: [4] });

		assert.deepStrictEqual(
			await probePausedPlacement(connection, {
				messageIdHeader: undefined,
				sourceMailboxPath: "INBOX",
				destinationMailboxPath: "Archive",
			}),
			{ kind: "unprobeable" },
		);
		assert.deepStrictEqual(opened, []);
	});
});

describe("searchMailboxForHighestMessageIdUid — the probe that binds a move to a UID (#912)", () => {
	const isMessageIdCriterion = (
		criterion: unknown,
	): criterion is [string, string, string] =>
		Array.isArray(criterion) &&
		criterion.length === 3 &&
		typeof criterion[0] === "string" &&
		criterion[0].toUpperCase() === "HEADER" &&
		typeof criterion[1] === "string" &&
		criterion[1].toLowerCase() === "message-id" &&
		typeof criterion[2] === "string";

	const buildDestination = (
		messages: Array<{ uid: number; messageIdHeader: string }>,
	): IImapConnection => {
		const searchAll = () => messages.map((row) => row.uid);
		return {
			openBox: async () => ({}) as never,
			search: async (criteria: unknown[]) => {
				const criterion = criteria.find(isMessageIdCriterion);
				if (criterion === undefined) return searchAll();
				return messages
					.filter((row) => row.messageIdHeader === criterion[2])
					.map((row) => row.uid);
			},
		} as unknown as IImapConnection;
	};

	it("asks the folder by Message-ID rather than by an interpolated string", async () => {
		const sent: unknown[][] = [];
		const destination = {
			openBox: async () => ({}) as never,
			search: async (criteria: unknown[]) => {
				sent.push(criteria);
				return [];
			},
		} as unknown as IImapConnection;

		await searchMailboxForHighestMessageIdUid(
			destination,
			"Archive",
			'<a"b@example.com>\r\nUID 1',
		);

		assert.deepStrictEqual(sent, [
			[["HEADER", "Message-ID", '<a"b@example.com>\r\nUID 1']],
		]);
	});

	it("answers null, not another message's UID, when the folder holds no such message", async () => {
		const destination = buildDestination([
			{ uid: 11, messageIdHeader: "<stranger-a@example.com>" },
			{ uid: 12, messageIdHeader: "<stranger-b@example.com>" },
		]);

		assert.strictEqual(
			await searchMailboxForHighestMessageIdUid(
				destination,
				"Archive",
				"<moved@example.com>",
			),
			null,
		);
	});

	it("answers the UID of the message carrying that Message-ID", async () => {
		const destination = buildDestination([
			{ uid: 11, messageIdHeader: "<stranger-a@example.com>" },
			{ uid: 12, messageIdHeader: "<moved@example.com>" },
		]);

		assert.strictEqual(
			await searchMailboxForHighestMessageIdUid(
				destination,
				"Archive",
				"<moved@example.com>",
			),
			12,
		);
	});

	// Issue #1122. The folder already held an older copy of this Message-ID — a
	// sieve `fileinto` + `keep`, a resend, an earlier copy of the same message —
	// and the uid this probe hands back settles the row the fresh copy lives in.
	// Answering 12 binds that row to mail this operation never touched and
	// leaves the copy that just arrived unreachable by any later delete.
	it("answers the newest copy's UID when the folder already held an older copy of it", async () => {
		const destination = buildDestination([
			{ uid: 12, messageIdHeader: "<moved@example.com>" },
			{ uid: 40, messageIdHeader: "<moved@example.com>" },
		]);

		assert.strictEqual(
			await searchMailboxForHighestMessageIdUid(
				destination,
				"Archive",
				"<moved@example.com>",
			),
			40,
		);
	});

	// RFC 3501 does not order a SEARCH response, so the fresh copy is the
	// highest uid returned rather than the last one returned.
	it("takes the highest match whatever order the server lists them in", async () => {
		const destination = buildDestination([
			{ uid: 40, messageIdHeader: "<moved@example.com>" },
			{ uid: 12, messageIdHeader: "<moved@example.com>" },
		]);

		assert.strictEqual(
			await searchMailboxForHighestMessageIdUid(
				destination,
				"Archive",
				"<moved@example.com>",
			),
			40,
		);
	});
});
