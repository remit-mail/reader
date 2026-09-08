import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type SpamMailboxCount, spamOfferFromCounts } from "./spam-offer";

const exact = (mailboxId: string, value: number): SpamMailboxCount => ({
	mailboxId,
	count: { kind: "exact", value },
	failed: false,
});

const uncounted = (mailboxId: string): SpamMailboxCount => ({
	mailboxId,
	count: { kind: "unknown" },
	failed: false,
});

const errored = (mailboxId: string): SpamMailboxCount => ({
	mailboxId,
	count: { kind: "unknown" },
	failed: true,
});

/** The loaded page held no junk row of its own. */
const NO_PAGE_ROWS = { pageRowsByMailbox: new Map<string, number>() };

const pageRows = (
	entries: Record<string, number>,
): { pageRowsByMailbox: ReadonlyMap<string, number> } => ({
	pageRowsByMailbox: new Map(Object.entries(entries)),
});

describe("spamOfferFromCounts", () => {
	it("makes no offer when there is no junk folder to count", () => {
		assert.equal(spamOfferFromCounts([], NO_PAGE_ROWS), undefined);
	});

	it("makes no offer when every junk folder counted zero", () => {
		assert.equal(
			spamOfferFromCounts(
				[exact("mb-junk-a", 0), exact("mb-junk-b", 0)],
				NO_PAGE_ROWS,
			),
			undefined,
		);
	});

	it("states the server's count for the one junk folder", () => {
		assert.deepEqual(
			spamOfferFromCounts([exact("mb-junk", 42)], NO_PAGE_ROWS),
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
				NO_PAGE_ROWS,
			),
			{ mailboxId: "mb-junk-b", count: { kind: "exact", value: 12 } },
		);
	});

	it("sends the reader to the junk folder holding the most matches", () => {
		assert.equal(
			spamOfferFromCounts(
				[exact("mb-junk-a", 1), exact("mb-junk-b", 9)],
				NO_PAGE_ROWS,
			)?.mailboxId,
			"mb-junk-b",
		);
	});

	it("breaks a tie on folder order, so the destination does not flip", () => {
		assert.equal(
			spamOfferFromCounts(
				[exact("mb-junk-a", 4), exact("mb-junk-b", 4)],
				NO_PAGE_ROWS,
			)?.mailboxId,
			"mb-junk-a",
		);
	});

	it("states no number when one junk folder went uncounted", () => {
		// Summing only the folders that answered would state a figure that is exact
		// in form and short in fact.
		assert.deepEqual(
			spamOfferFromCounts(
				[exact("mb-junk-a", 5), uncounted("mb-junk-b")],
				NO_PAGE_ROWS,
			),
			{ mailboxId: "mb-junk-a", count: { kind: "unknown" } },
		);
	});

	it("stands down when nothing is known and the page held no spam either", () => {
		assert.equal(
			spamOfferFromCounts(
				[uncounted("mb-junk-a"), uncounted("mb-junk-b")],
				NO_PAGE_ROWS,
			),
			undefined,
		);
	});

	// A failed count is not a folder saying it holds nothing. Dropping the offer
	// on one would make a lapsed session look exactly like a clean search.
	it("keeps the offer when a count request failed", () => {
		assert.deepEqual(
			spamOfferFromCounts(
				[exact("mb-junk-a", 0), errored("mb-junk-b")],
				NO_PAGE_ROWS,
			),
			{ mailboxId: "mb-junk-b", count: { kind: "unknown" } },
		);
	});

	it("does not read an uncounted folder as an empty one", () => {
		assert.deepEqual(
			spamOfferFromCounts(
				[exact("mb-junk-a", 0), uncounted("mb-junk-b")],
				pageRows({ "mb-junk-b": 1 }),
			),
			{ mailboxId: "mb-junk-b", count: { kind: "unknown" } },
		);
	});
});

describe("spamOfferFromCounts destination", () => {
	// The regression: with counts switched off, every folder is `unknown` and the
	// destination fell to whichever folder happened to be first. Two accounts,
	// every held-out row in B's Spam, and the button opened A's — "No matches"
	// over mail the list was holding out on the very same screen.
	it("follows the page's junk rows when no folder was counted", () => {
		assert.equal(
			spamOfferFromCounts(
				[uncounted("mb-junk-a"), uncounted("mb-junk-b")],
				pageRows({ "mb-junk-b": 3 }),
			)?.mailboxId,
			"mb-junk-b",
		);
	});

	// An exact zero is the one folder known to hold nothing, so it is the one
	// destination guaranteed to show an empty list — below a folder that simply
	// has not answered.
	it("never sends the reader to a folder that counted zero", () => {
		assert.equal(
			spamOfferFromCounts(
				[exact("mb-junk-a", 0), uncounted("mb-junk-b"), errored("mb-junk-c")],
				NO_PAGE_ROWS,
			)?.mailboxId,
			"mb-junk-b",
		);
	});

	it("prefers a counted match over the folder the page's rows came from", () => {
		assert.equal(
			spamOfferFromCounts(
				[exact("mb-junk-a", 9), uncounted("mb-junk-b")],
				pageRows({ "mb-junk-b": 4 }),
			)?.mailboxId,
			"mb-junk-a",
		);
	});

	// The mailbox lists are still loading, or the folder arrived after the count
	// requests went out. Its rows are already held out of the list, so it has to
	// be reachable.
	it("offers a junk folder the page names and the counts do not", () => {
		assert.deepEqual(spamOfferFromCounts([], pageRows({ "mb-junk-late": 2 })), {
			mailboxId: "mb-junk-late",
			count: { kind: "unknown" },
		});
	});

	// A count that says nothing over a page that is holding junk rows is stale by
	// up to its half-minute. The rows are on screen; the offer stands and states
	// no figure rather than "0 results from Spam".
	it("states no number when an exact zero contradicts the page's rows", () => {
		assert.deepEqual(
			spamOfferFromCounts(
				[exact("mb-junk-a", 0), exact("mb-junk-b", 0)],
				pageRows({ "mb-junk-b": 2 }),
			),
			{ mailboxId: "mb-junk-b", count: { kind: "unknown" } },
		);
	});
});
