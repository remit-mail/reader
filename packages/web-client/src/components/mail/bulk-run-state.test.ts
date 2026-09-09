import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BulkRunOutcome } from "@/lib/bulk-actions";
import { bulkRunReport } from "./bulk-run-state";

const ended = (over: Partial<BulkRunOutcome> = {}): BulkRunOutcome => ({
	done: 0,
	failedIds: [],
	refused: 0,
	cancelled: false,
	...over,
});

const report = (
	over: Partial<Parameters<typeof bulkRunReport>[0]> = {},
): ReturnType<typeof bulkRunReport> =>
	bulkRunReport({
		matched: 100,
		outcome: undefined,
		failureReason: undefined,
		progressDone: 0,
		...over,
	});

describe("what the run screen says a bulk run did", () => {
	it("shows a run still going against what it was started with", () => {
		assert.deepEqual(report({ progressDone: 40 }), {
			state: "backApplyRunning",
			matched: 100,
			applied: 40,
			failed: 0,
			failedIds: [],
		});
	});

	it("never reads more done than out of", () => {
		const going = report({ matched: 1284, progressDone: 1340 });
		assert.equal(going.matched, 1340);
	});

	it("ends a run that covered its match on the success screen", () => {
		const covered = report({ outcome: ended({ done: 100 }) });
		assert.equal(covered.state, "backApplyComplete");
		assert.equal(covered.applied, 100);
	});

	it("carries a commit that never started, and why", () => {
		const never = report({ failureReason: "There is no Junk folder" });
		assert.equal(never.state, "commitFailed");
		assert.equal(never.failureReason, "There is no Junk folder");
		assert.equal(never.matched, 0);
	});

	it("says a run that errored before anything landed never started", () => {
		const threw = report({ outcome: ended({ error: new Error("500") }) });
		assert.equal(threw.state, "commitFailed");
	});
});

/**
 * Regression for #113. A stop used to be read only between pages, so it always
 * landed with at least one batch already applied and `done === 0` could only
 * mean a failure. Aborting the request in flight makes zero the ordinary
 * outcome of stopping during the first batch — the only batch a selection of a
 * hundred or fewer ever has — and answering that with the danger screen told
 * the user nothing had changed while the server had most likely taken all of
 * them.
 */
describe("a run the user stopped", () => {
	it("reports a stop during the first batch as stopped, not as a failed start", () => {
		const stopped = report({
			matched: 100,
			outcome: ended({ cancelled: true, failedIds: Array(100).fill("m") }),
		});
		assert.equal(stopped.state, "runStopped");
		assert.notEqual(stopped.state, "commitFailed");
		assert.equal(stopped.applied, 0);
		assert.equal(stopped.failed, 100);
	});

	it("reports a stop that reached nothing at all as stopped too", () => {
		// The escalated path hands back no remainder: the predicate re-resolves on
		// every run, so there are no ids to list, only a difference to name.
		const stopped = report({
			matched: 3000,
			outcome: ended({ cancelled: true }),
		});
		assert.equal(stopped.state, "runStopped");
		assert.equal(stopped.failed, 3000);
	});

	it("still reports a stop that got part-way", () => {
		const stopped = report({
			matched: 3000,
			outcome: ended({ done: 1200, cancelled: true }),
		});
		assert.equal(stopped.state, "runStopped");
		assert.equal(stopped.applied, 1200);
		assert.equal(stopped.failed, 1800);
	});
});
