import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runEndingBanner } from "@/lib/bulk-action-copy";
import type { BulkRunOutcome } from "@/lib/bulk-actions";
import { type DeleteOutcome, deleteExpunges } from "@/lib/format";

/**
 * A run states how it ended, to whoever is still there to read it (#521). The
 * run screen invites the user to close it and keep the run going, which leaves
 * the run with no screen of its own — so the list says what it reached, whether
 * that was everything or a hundred out of three thousand.
 *
 * Which ending gets which banner is `runEndingBanner`, and it is asserted here
 * by its result. It used to be asserted by matching the source text of
 * `reportRunOutcome`, which meant the rule held only as long as nobody moved
 * those lines — adding an argument to the completion call broke all three
 * cases while the behaviour they protect was intact. The one fact that still
 * cannot be read off a result is the wiring: that the wizard is handed
 * somewhere to report an ending after it has closed. That stays a source read,
 * because reaching it otherwise means mounting the list's virtualizer, router
 * and data hooks around a run that has already finished.
 *
 * Which runs reach this seam at all is `SelectionWizardHost.run-exit.test.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "MessageList.tsx"), "utf8");

const expunging: DeleteOutcome[] = ["permanent", "unconfirmed"];

const ended = (over: Partial<BulkRunOutcome> = {}): BulkRunOutcome => ({
	done: 100,
	failedIds: [],
	cancelled: false,
	...over,
});

describe("reporting how a run ended", () => {
	it("hands the wizard somewhere to report an ending it can no longer show", () => {
		const host = source.match(/<SelectionWizardHost[\s\S]*?\/>/)?.[0] ?? "";
		assert.match(host, /onRunEnded=\{reportRunOutcome\}/);
		assert.match(
			source,
			/const reportRunOutcome = useCallback\(/,
			"the list reports no run outcome",
		);
		assert.match(
			source,
			/runEndingBanner\(kind, matched, outcome, deleteOutcome\)/,
			"and the ending it reports is the one runEndingBanner decides",
		);
	});

	it("names both endings: what it covered, and what it stopped short of", () => {
		const stopped = runEndingBanner(
			"delete",
			3000,
			ended({ cancelled: true }),
			"trash",
		);
		assert.equal(stopped?.title, "Stopped after 100");
		assert.match(stopped?.detail ?? "", /100 of 3,000 moved to Trash\./);
		assert.match(stopped?.detail ?? "", /Nothing was sent for the rest/);

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

describe("the run the wizard leaves behind", () => {
	it("is stoppable from the wizard, which is not the same as closing it", () => {
		assert.match(source, /stop: escalation\.stop,/);
	});

	it("keeps reporting on the bar from the moment it starts", () => {
		assert.match(
			source,
			/escalation\.progress\?\.total \?\? selectionCount/,
			"a run with no batch finished yet has no denominator to show",
		);
	});
});
