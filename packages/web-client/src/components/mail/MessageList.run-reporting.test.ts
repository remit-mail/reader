import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runEndingBanner } from "@/lib/bulk-action-copy";
import type { BulkRunOutcome } from "@/lib/bulk-actions";
import { type DeleteOutcome, deleteExpunges } from "@/lib/format";

/**
 * A run states how it ended, to whoever is still there to read it (#521). The
 * run screen invites the user to close it and keep the run going, which leaves
 * the run with no screen of its own — so the list says what it reached, whether
 * that was everything or a hundred out of three thousand.
 *
 * Which ending gets which banner is `runEndingBanner`, asserted here by its
 * result.
 */

const expunging: DeleteOutcome[] = ["permanent", "unconfirmed"];

const ended = (over: Partial<BulkRunOutcome> = {}): BulkRunOutcome => ({
	done: 100,
	failedIds: [],
	refused: 0,
	cancelled: false,
	...over,
});

describe("reporting how a run ended", () => {
	it("names both endings: what it covered, and what it stopped short of", () => {
		const stopped = runEndingBanner(
			"delete",
			3000,
			ended({ cancelled: true }),
			"trash",
		);
		assert.equal(stopped?.title, "Stopped after 100");
		assert.match(stopped?.detail ?? "", /100 of 3,000 moved to Trash\./);
		assert.match(stopped?.detail ?? "", /The rest were not sent/);

		const covered = runEndingBanner("delete", 100, ended(), "trash");
		assert.match(covered?.title ?? "", /^100 moved to Trash\./);
	});

	it("raises a stopped run as a warning rather than a passing note", () => {
		assert.equal(
			runEndingBanner("delete", 3000, ended({ cancelled: true }), "trash")
				?.severity,
			"warning",
			"mail the user asked to be acted on was left untouched",
		);
		assert.equal(
			runEndingBanner("delete", 100, ended(), "trash")?.severity,
			"info",
		);
	});

	it("says nothing about a run a thrown batch already bannered", () => {
		assert.equal(
			runEndingBanner(
				"delete",
				100,
				ended({ error: new Error("boom") }),
				"trash",
			),
			null,
			"saying it twice is the one wrong answer",
		);
	});

	// Both outcomes a row already inside Trash produces, because both erase it.
	// `unconfirmed` is only ever reached that way (#876), and a ternary that knew
	// only `permanent` reported an expunge as "moved to Trash".
	for (const outcome of expunging) {
		it(`names a ${outcome} delete as an expunge, however the run ended`, () => {
			assert.ok(deleteExpunges(outcome), "the copy reads this predicate");
			assert.match(
				runEndingBanner("delete", 100, ended(), outcome)?.title ?? "",
				/^100 permanently deleted\./,
			);
			assert.match(
				runEndingBanner("delete", 3000, ended({ cancelled: true }), outcome)
					?.detail ?? "",
				/100 of 3,000 permanently deleted\./,
				"the half that ran is erased whether or not the rest did",
			);
		});
	}
});
