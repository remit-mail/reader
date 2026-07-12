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
