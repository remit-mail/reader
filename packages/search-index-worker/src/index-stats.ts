import type { IndexOutcome } from "./handler.js";

/**
 * A window of index outcomes. `noop` is the proxy metric for over-triggering:
 * an indexed message that embedded nothing (`upserted: 0`) means an event fired
 * for content already in the store. A high noop rate is the signal that error
 * and DLQ alarms can't see — "too much successful work" — and is what let the
 * AWS search-index cost blowup ramp unnoticed (#1082). Pg-only: the Lambda path
 * never wires `Services.onIndexOutcome`, so this only accumulates in the
 * long-running Postgres consumer (`consumer.ts`).
 */
export interface IndexWorkSummary {
	processed: number;
	/** Indexed and wrote vectors — real work. */
	embedded: number;
	/** Indexed but wrote nothing (`upserted: 0`) — an event for unchanged content. */
	noop: number;
	/** Transient skip (thread/body not visible yet); left undrained for retry. */
	deferred: number;
	/** Terminal skip; drained, will never index. */
	dropped: number;
	/** Of the above, how many were force re-indexes (moves) — always re-embedded. */
	forced: number;
}

export interface IndexWorkStats {
	record(outcome: IndexOutcome, force: boolean): void;
	/** Return the accumulated window and reset it; null if nothing was recorded. */
	drain(): IndexWorkSummary | null;
}

const empty = (): IndexWorkSummary => ({
	processed: 0,
	embedded: 0,
	noop: 0,
	deferred: 0,
	dropped: 0,
	forced: 0,
});

export const createIndexWorkStats = (): IndexWorkStats => {
	let window = empty();
	return {
		record: (outcome, force) => {
			window.processed += 1;
			if (force) window.forced += 1;
			if (outcome.status === "indexed") {
				if (outcome.upserted > 0) window.embedded += 1;
				else window.noop += 1;
				return;
			}
			if (outcome.retryable) window.deferred += 1;
			else window.dropped += 1;
		},
		drain: () => {
			if (window.processed === 0) return null;
			const summary = window;
			window = empty();
			return summary;
		},
	};
};
