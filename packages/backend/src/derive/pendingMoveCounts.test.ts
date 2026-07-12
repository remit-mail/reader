import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailboxItem } from "@remit/remit-electrodb-service";
import { applyPendingMoveCountPrediction } from "./pendingMoveCounts.js";

const buildMailbox = (
	mailboxId: string,
	messageCount: number,
): Pick<MailboxItem, "mailboxId" | "messageCount"> => ({
	mailboxId,
	messageCount,
});

describe("applyPendingMoveCountPrediction (issue #1271, epic #1281 invariant 4)", () => {
	it("returns mailboxes unchanged when there are no pending moves", () => {
		const mailboxes = [buildMailbox("junk", 10), buildMailbox("inbox", 5)];

		const result = applyPendingMoveCountPrediction(
			mailboxes as MailboxItem[],
			[],
		);

		assert.deepEqual(result, mailboxes);
	});

	it("decrements the source and increments the destination by one per pending move", () => {
		const mailboxes = [buildMailbox("junk", 10), buildMailbox("inbox", 5)];

		const result = applyPendingMoveCountPrediction(mailboxes as MailboxItem[], [
			{ sourceMailboxId: "junk", destinationMailboxId: "inbox" },
		]);

		assert.equal(result.find((m) => m.mailboxId === "junk")?.messageCount, 9);
		assert.equal(result.find((m) => m.mailboxId === "inbox")?.messageCount, 6);
	});

	it("accumulates multiple pending moves between the same two folders", () => {
		const mailboxes = [buildMailbox("junk", 10), buildMailbox("inbox", 5)];

		const result = applyPendingMoveCountPrediction(mailboxes as MailboxItem[], [
			{ sourceMailboxId: "junk", destinationMailboxId: "inbox" },
			{ sourceMailboxId: "junk", destinationMailboxId: "inbox" },
			{ sourceMailboxId: "junk", destinationMailboxId: "inbox" },
		]);

		assert.equal(result.find((m) => m.mailboxId === "junk")?.messageCount, 7);
		assert.equal(result.find((m) => m.mailboxId === "inbox")?.messageCount, 8);
	});

	it("never goes negative even if the stored count is already stale/behind", () => {
		const mailboxes = [buildMailbox("junk", 0)];

		const result = applyPendingMoveCountPrediction(mailboxes as MailboxItem[], [
			{ sourceMailboxId: "junk", destinationMailboxId: "inbox" },
		]);

		assert.equal(result.find((m) => m.mailboxId === "junk")?.messageCount, 0);
	});

	it("leaves a mailbox with no affecting moves untouched (same object reference)", () => {
		const untouched = buildMailbox("drafts", 3) as MailboxItem;
		const mailboxes = [buildMailbox("junk", 10) as MailboxItem, untouched];

		const result = applyPendingMoveCountPrediction(mailboxes, [
			{ sourceMailboxId: "junk", destinationMailboxId: "inbox" },
		]);

		assert.equal(
			result.find((m) => m.mailboxId === "drafts"),
			untouched,
		);
	});

	it("ignores a no-op move where source equals destination", () => {
		const mailboxes = [buildMailbox("junk", 10)];

		const result = applyPendingMoveCountPrediction(mailboxes as MailboxItem[], [
			{ sourceMailboxId: "junk", destinationMailboxId: "junk" },
		]);

		assert.equal(result.find((m) => m.mailboxId === "junk")?.messageCount, 10);
	});

	it("is pure — never mutates the input array or its items", () => {
		const mailboxes = [buildMailbox("junk", 10), buildMailbox("inbox", 5)];
		const snapshot = JSON.parse(JSON.stringify(mailboxes));

		applyPendingMoveCountPrediction(mailboxes as MailboxItem[], [
			{ sourceMailboxId: "junk", destinationMailboxId: "inbox" },
		]);

		assert.deepEqual(mailboxes, snapshot);
	});
});

const buildMailboxFull = (
	mailboxId: string,
	messageCount: number,
	unseenCount: number,
): Pick<MailboxItem, "mailboxId" | "messageCount" | "unseenCount"> => ({
	mailboxId,
	messageCount,
	unseenCount,
});

describe("applyPendingMoveCountPrediction — pending \\Seen flag pushes (issue #1273, epic #1281 invariant 4)", () => {
	it("decrements unseenCount by one for a pending mark-as-read (add) push", () => {
		const mailboxes = [buildMailboxFull("inbox", 20, 5)];

		const result = applyPendingMoveCountPrediction(
			mailboxes as MailboxItem[],
			[],
			[{ mailboxId: "inbox", operation: "add" }],
		);

		assert.equal(result.find((m) => m.mailboxId === "inbox")?.unseenCount, 4);
		// messageCount is untouched by a flag push — only location changes affect it.
		assert.equal(result.find((m) => m.mailboxId === "inbox")?.messageCount, 20);
	});

	it("increments unseenCount by one for a pending mark-as-unread (remove) push", () => {
		const mailboxes = [buildMailboxFull("inbox", 20, 5)];

		const result = applyPendingMoveCountPrediction(
			mailboxes as MailboxItem[],
			[],
			[{ mailboxId: "inbox", operation: "remove" }],
		);

		assert.equal(result.find((m) => m.mailboxId === "inbox")?.unseenCount, 6);
	});

	it("accumulates multiple pending pushes for the same mailbox", () => {
		const mailboxes = [buildMailboxFull("inbox", 20, 5)];

		const result = applyPendingMoveCountPrediction(
			mailboxes as MailboxItem[],
			[],
			[
				{ mailboxId: "inbox", operation: "add" },
				{ mailboxId: "inbox", operation: "add" },
			],
		);

		assert.equal(result.find((m) => m.mailboxId === "inbox")?.unseenCount, 3);
	});

	it("never goes negative even if the stored unseenCount is already stale/behind", () => {
		const mailboxes = [buildMailboxFull("inbox", 20, 0)];

		const result = applyPendingMoveCountPrediction(
			mailboxes as MailboxItem[],
			[],
			[{ mailboxId: "inbox", operation: "add" }],
		);

		assert.equal(result.find((m) => m.mailboxId === "inbox")?.unseenCount, 0);
	});

	it("applies placement-move messageCount and flag-push unseenCount predictions independently, in one pass", () => {
		const mailboxes = [
			buildMailboxFull("junk", 10, 2),
			buildMailboxFull("inbox", 5, 3),
		];

		const result = applyPendingMoveCountPrediction(
			mailboxes as MailboxItem[],
			[{ sourceMailboxId: "junk", destinationMailboxId: "inbox" }],
			[{ mailboxId: "inbox", operation: "add" }],
		);

		const inbox = result.find((m) => m.mailboxId === "inbox");
		assert.equal(inbox?.messageCount, 6, "moved-in message");
		assert.equal(inbox?.unseenCount, 2, "one pending read");

		const junk = result.find((m) => m.mailboxId === "junk");
		assert.equal(junk?.messageCount, 9);
		assert.equal(junk?.unseenCount, 2, "unaffected by the flag push");
	});

	it("confirming the push (marker deleted) means it no longer feeds the prediction — no double-count", () => {
		const mailboxes = [buildMailboxFull("inbox", 20, 5)];

		// Before confirmation: marker present, prediction applies.
		const pending = applyPendingMoveCountPrediction(
			mailboxes as MailboxItem[],
			[],
			[{ mailboxId: "inbox", operation: "add" }],
		);
		assert.equal(pending.find((m) => m.mailboxId === "inbox")?.unseenCount, 4);

		// After confirmation: the imap-worker deletes the marker AND the next
		// resync recomputes the stored unseenCount from IMAP (here simulated as
		// already reflecting the drop, 4). With no marker left, the caller never
		// passes it into the prediction again — applying the SAME prediction
		// twice would incorrectly double-count.
		const confirmedMailboxes = [buildMailboxFull("inbox", 20, 4)];
		const afterConfirm = applyPendingMoveCountPrediction(
			confirmedMailboxes as MailboxItem[],
			[],
			[],
		);
		assert.equal(
			afterConfirm.find((m) => m.mailboxId === "inbox")?.unseenCount,
			4,
			"the confirmed, IMAP-recomputed value stands — no further adjustment",
		);
	});

	it("is pure — never mutates the input array or its items", () => {
		const mailboxes = [buildMailboxFull("inbox", 20, 5)];
		const snapshot = JSON.parse(JSON.stringify(mailboxes));

		applyPendingMoveCountPrediction(
			mailboxes as MailboxItem[],
			[],
			[{ mailboxId: "inbox", operation: "add" }],
		);

		assert.deepEqual(mailboxes, snapshot);
	});
});
