import assert from "node:assert";
import { afterEach, before, describe, it, mock } from "node:test";
import { getClient, type RemitClient, setClient } from "@remit/backend/client";
import type { AccountItem, ThreadMessageItem } from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import type { IImapConnection } from "@remit/mailbox-service";
import type { MessageMoveEvent } from "../events.js";
import {
	buildThreadMessageMoveUpdate,
	emitMoveResync,
	getMessageMoveMaxAttempts,
	handleMessageMove,
	MESSAGE_MOVE_MAX_ATTEMPTS,
	moveThenResync,
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
			},
			secrets: { decrypt: async () => undefined },
		} as unknown as RemitClient);
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
