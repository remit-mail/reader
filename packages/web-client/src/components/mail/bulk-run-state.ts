import type { RunState } from "@remit/ui";
import type { BulkRunOutcome } from "@/lib/bulk-actions";

/** What the run screen knows about a chunked bulk run it is reporting on. */
export interface BulkRunReading {
	/** The count the run was started against. */
	matched: number;
	/** Set once the run has ended, for any reason. */
	outcome: BulkRunOutcome | undefined;
	/**
	 * Why the commit never started, when the reason is one the same commit cannot
	 * get past (#522).
	 */
	failureReason: string | undefined;
	/** Ids covered so far, read off the progress bar while the run is going. */
	progressDone: number;
}

export interface BulkRunReport {
	state: RunState;
	matched: number;
	applied: number;
	failed: number;
	/** Ids the run leaves unconfirmed; the screen resolves them to rows. */
	failedIds: readonly string[];
	failureReason?: string;
}

const NOTHING_STARTED = {
	matched: 0,
	applied: 0,
	failed: 0,
	failedIds: [] as readonly string[],
};

/**
 * What the run screen says a bulk run did.
 *
 * Stopping is read before counting, because a stop is not a failure however
 * little it reached (#113). Pressing Stop during the first batch — the only
 * batch a selection of 100 or fewer has — leaves `done` at zero while the
 * server has most likely applied all of them, and answering that with
 * "Couldn't start deleting / Nothing has changed" is both alarming and wrong.
 * Only a run that errored before anything landed has nothing to report but the
 * failure.
 */
export const bulkRunReport = ({
	matched,
	outcome,
	failureReason,
	progressDone,
}: BulkRunReading): BulkRunReport => {
	// Nothing was sent, and nothing about sending it again resolves what was
	// missing — so the screen carries why rather than the generic ending (#522).
	if (failureReason !== undefined) {
		return { ...NOTHING_STARTED, state: "commitFailed", failureReason };
	}
	if (!outcome) {
		// A predicate matches more by the time the run re-pages it than the count
		// saw, so what it has covered can overtake what it was offered against.
		// The bar never reads more done than out of, and neither does this.
		return {
			state: "backApplyRunning",
			matched: Math.max(matched, progressDone),
			applied: progressDone,
			failed: 0,
			failedIds: [],
		};
	}
	if (!outcome.cancelled && outcome.error === undefined) {
		return {
			state: "backApplyComplete",
			matched: Math.max(matched, outcome.done),
			applied: outcome.done,
			failed: 0,
			failedIds: [],
		};
	}
	if (!outcome.cancelled && outcome.done === 0) {
		return { ...NOTHING_STARTED, state: "commitFailed" };
	}
	// The run stopped part-way. Nothing here was rejected: a returned bulk call
	// accepts every id in it, so the only failure this layer sees is a call that
	// threw or was aborted, and everything after it was never sent. A bounded run
	// hands back exactly those ids; a predicate run re-resolves its match on every
	// pass and has no remainder to hand back, so what is left is the difference
	// between the count and what the run covered.
	const unreached =
		outcome.failedIds.length > 0
			? outcome.failedIds.length
			: Math.max(matched - outcome.done, 1);
	return {
		state: "runStopped",
		matched: Math.max(matched, outcome.done),
		applied: outcome.done,
		failed: unreached,
		failedIds: outcome.failedIds,
	};
};
