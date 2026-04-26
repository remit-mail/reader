import assert from "node:assert";
import { describe, it } from "node:test";
import type { ThreadMessageItem } from "@remit/remit-electrodb-service";
import { buildThreadMessageTrashUpdate } from "./message-delete.js";

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
