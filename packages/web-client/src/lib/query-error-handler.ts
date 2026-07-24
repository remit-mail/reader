import type { Mutation, Query } from "@tanstack/react-query";
import { isBackgroundPoll, shouldEscalate } from "./error-classifier";
import { reportFatalError } from "./fatal-error";

/**
 * Global React Query error sink. Every query and mutation error flows through
 * here (wired on the `QueryCache`/`MutationCache` in the shell). The fail-fast
 * contract (#1059) lives in `shouldEscalate`: a non-2xx escalates to the
 * full-screen red overlay by default; a 5xx escalates; only aborts, statusless
 * network blips, non-5xx errors a call site opted out of via `meta.softError`,
 * and transient 5xx on a background poll (#225) stay soft.
 *
 * This is the v5 equivalent of `defaultOptions.queries.onError` /
 * `.mutations.onError` — v5 moved the global error hook onto the caches.
 */

/**
 * Consecutive failed fetches of a background poll, counted since its last
 * success. React Query resets `fetchFailureCount` at the start of every fetch,
 * so that field counts retries *within* one fetch, not failures *across* polls;
 * the cross-poll streak is what tells a persistent outage from a one-second
 * blip, so we track it ourselves. Keyed by the stable `Query` object (one per
 * queryHash, reused across refetches) in a `WeakMap` so entries vanish with the
 * query, and reset whenever the query's success count (`dataUpdateCount`)
 * advances — a success between failures breaks the streak.
 */
const backgroundPollFailures = new WeakMap<
	Query<unknown, unknown, unknown>,
	{ successesAtStreakStart: number; consecutive: number }
>();

const recordBackgroundPollFailure = (
	query: Query<unknown, unknown, unknown>,
): number => {
	const successes = query.state.dataUpdateCount;
	const streak = backgroundPollFailures.get(query);
	if (!streak || streak.successesAtStreakStart !== successes) {
		backgroundPollFailures.set(query, {
			successesAtStreakStart: successes,
			consecutive: 1,
		});
		return 1;
	}
	streak.consecutive += 1;
	return streak.consecutive;
};

export const handleQueryCacheError = (
	error: Error,
	query: Query<unknown, unknown, unknown>,
): void => {
	const consecutiveFailures = isBackgroundPoll(query.meta)
		? recordBackgroundPollFailure(query)
		: undefined;
	if (shouldEscalate(error, query.meta, { consecutiveFailures })) {
		reportFatalError(error);
	}
};

export const handleMutationCacheError = (
	error: unknown,
	_variables: unknown,
	_onMutateResult: unknown,
	mutation: Mutation<unknown, unknown, unknown>,
): void => {
	if (shouldEscalate(error, mutation.meta)) {
		reportFatalError(error);
	}
};
