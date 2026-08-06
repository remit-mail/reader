import assert from "node:assert";
import { afterEach, before, describe, it, mock } from "node:test";
import { getClient, type RemitClient, setClient } from "@remit/backend/client";
import type { AccountItem, ThreadMessageItem } from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import type { MessageMoveEvent } from "../events.js";
import {
	buildThreadMessageMoveUpdate,
	emitMoveResync,
	getMessageMoveMaxAttempts,
	handleMessageMove,
	MESSAGE_MOVE_MAX_ATTEMPTS,
	moveThenResync,
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

describe("getMessageMoveMaxAttempts — env-derived threshold (mirrors #1270's getBodySyncMaxAttempts / getFlagPushMaxAttempts)", () => {
	it("parses the CDK-injected env var", () => {
		assert.equal(
			getMessageMoveMaxAttempts({ MESSAGE_MOVE_MAX_ATTEMPTS: "3" }),
			3,
		);
		assert.equal(
			getMessageMoveMaxAttempts({ MESSAGE_MOVE_MAX_ATTEMPTS: "5" }),
			5,
		);
	});

	it("defaults to 3 when unset", () => {
		assert.equal(getMessageMoveMaxAttempts({}), 3);
	});

	it("defaults to 3 on a non-numeric or non-positive value", () => {
		assert.equal(
			getMessageMoveMaxAttempts({ MESSAGE_MOVE_MAX_ATTEMPTS: "nope" }),
			3,
		);
		assert.equal(
			getMessageMoveMaxAttempts({ MESSAGE_MOVE_MAX_ATTEMPTS: "0" }),
			3,
		);
		assert.equal(
			getMessageMoveMaxAttempts({ MESSAGE_MOVE_MAX_ATTEMPTS: "-1" }),
			3,
		);
	});

	it("the module-level constant reflects the actual process env at load time", () => {
		assert.equal(typeof MESSAGE_MOVE_MAX_ATTEMPTS, "number");
		assert.ok(MESSAGE_MOVE_MAX_ATTEMPTS > 0);
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

describe("handleMessageMove — deleted mailbox is terminal (#287/#289)", () => {
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

	// The client is supplied by injection (`setClient`), so these tests register
	// the repositories they then mock rather than reaching a composition.
	before(() => {
		setClient({
			account: { get: async () => undefined },
			mailbox: { get: async () => undefined },
			message: { updateUid: async () => undefined },
			secrets: { decrypt: async () => undefined },
		} as unknown as RemitClient);
	});

	afterEach(() => mock.restoreAll());

	it("acks without connecting when the source mailbox was deleted", async () => {
		const client = await getClient();
		mock.method(client.account, "get", async () => cappedAccount());
		mock.method(client.secrets, "decrypt", async () => "fake-password");
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
});
