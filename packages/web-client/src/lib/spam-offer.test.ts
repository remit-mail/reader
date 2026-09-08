import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type SpamMailboxCount, spamOfferFromCounts } from "./spam-offer";

const exact = (mailboxId: string, value: number): SpamMailboxCount => ({
	mailboxId,
	count: { kind: "exact", value },
});

const uncounted = (mailboxId: string): SpamMailboxCount => ({
	mailboxId,
	count: { kind: "unknown" },
});

/** The rows the caller loaded held no spam of their own. */
const NO_PAGE_SPAM = { pageHeldSpam: false };
const PAGE_HELD_SPAM = { pageHeldSpam: true };

describe("spamOfferFromCounts", () => {
	it("makes no offer when there is no junk folder to count", () => {
		assert.equal(spamOfferFromCounts([], NO_PAGE_SPAM), undefined);
	});

	it("makes no offer when every junk folder counted zero", () => {
		assert.equal(
			spamOfferFromCounts(
				[exact("mb-junk-a", 0), exact("mb-junk-b", 0)],
				NO_PAGE_SPAM,
			),
			undefined,
		);
	});

	it("states the server's count for the one junk folder", () => {
		assert.deepEqual(
			spamOfferFromCounts([exact("mb-junk", 42)], NO_PAGE_SPAM),
			{
				mailboxId: "mb-junk",
				count: { kind: "exact", value: 42 },
			},
		);
	});

	it("sums every junk folder, so several accounts read as one number", () => {
		assert.deepEqual(
			spamOfferFromCounts(
				[exact("mb-junk-a", 3), exact("mb-junk-b", 7), exact("mb-junk-c", 2)],
				NO_PAGE_SPAM,
			),
			{ mailboxId: "mb-junk-b", count: { kind: "exact", value: 12 } },
		);
	});

	it("sends the reader to the junk folder holding the most matches", () => {
		assert.equal(
			spamOfferFromCounts(
				[exact("mb-junk-a", 1), exact("mb-junk-b", 9)],
				NO_PAGE_SPAM,
			)?.mailboxId,
			"mb-junk-b",
		);
	});

	it("breaks a tie on folder order, so the destination does not flip", () => {
		assert.equal(
			spamOfferFromCounts(
				[exact("mb-junk-a", 4), exact("mb-junk-b", 4)],
				NO_PAGE_SPAM,
			)?.mailboxId,
			"mb-junk-a",
		);
	});

	it("states no number when one junk folder went uncounted", () => {
		// The offer stands — spam was reached — but summing only the folders that
		// answered would state a figure that is exact in form and short in fact.
		assert.deepEqual(
			spamOfferFromCounts(
				[exact("mb-junk-a", 5), uncounted("mb-junk-b")],
				NO_PAGE_SPAM,
			),
			{ mailboxId: "mb-junk-a", count: { kind: "unknown" } },
		);
	});

	it("still offers a destination when nothing was counted at all", () => {
		assert.deepEqual(
			spamOfferFromCounts(
				[uncounted("mb-junk-a"), uncounted("mb-junk-b")],
				PAGE_HELD_SPAM,
			),
			{ mailboxId: "mb-junk-a", count: { kind: "unknown" } },
		);
	});

	it("stands down when nothing is known and the page held no spam either", () => {
		// No folder reported a match and the loaded rows hold none, so there is no
		// evidence the search reaches spam at all — an offer here would be a guess.
		assert.equal(
			spamOfferFromCounts(
				[uncounted("mb-junk-a"), uncounted("mb-junk-b")],
				NO_PAGE_SPAM,
			),
			undefined,
		);
	});

	it("does not read an uncounted folder as an empty one", () => {
		// Exact zeroes plus one unknown is not "no spam anywhere": the folder that
		// did not answer may hold every match.
		assert.deepEqual(
			spamOfferFromCounts(
				[exact("mb-junk-a", 0), uncounted("mb-junk-b")],
				PAGE_HELD_SPAM,
			),
			{ mailboxId: "mb-junk-a", count: { kind: "unknown" } },
		);
	});
});
