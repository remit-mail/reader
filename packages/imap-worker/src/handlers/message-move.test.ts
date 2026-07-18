import assert from "node:assert";
import { describe, it, mock } from "node:test";
import type { ThreadMessageItem } from "@remit/data-ports";
import {
	buildThreadMessageMoveUpdate,
	emitMoveResync,
	moveThenResync,
} from "./message-move.js";

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
