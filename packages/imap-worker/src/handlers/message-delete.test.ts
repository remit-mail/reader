import assert from "node:assert";
import { describe, it, mock } from "node:test";
import type { ThreadMessageItem } from "@remit/remit-electrodb-service";
import {
	buildThreadMessageTrashUpdate,
	deleteAllThreadMessagesForMessage,
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
			"alice-msg-missing-aaaaaa",
		);

		assert.equal(count, 0);
		assert.equal(deleteRow.mock.calls.length, 0);
	});
});
