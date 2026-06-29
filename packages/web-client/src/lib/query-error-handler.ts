import type { Mutation, Query } from "@tanstack/react-query";
import { shouldEscalate } from "./error-classifier";
import { reportFatalError } from "./fatal-error";

/**
 * Global React Query error sink. Every query and mutation error flows through
 * here (wired on the `QueryCache`/`MutationCache` in main.tsx). The fail-fast
 * contract (#1059) lives in `shouldEscalate`: a non-2xx escalates to the
 * full-screen red overlay by default; a 5xx ALWAYS escalates; only aborts,
 * statusless network blips, and non-5xx errors a call site opted out of via
 * `meta.softError` stay soft.
 *
 * This is the v5 equivalent of `defaultOptions.queries.onError` /
 * `.mutations.onError` — v5 moved the global error hook onto the caches.
 */
export const handleQueryCacheError = (
	error: Error,
	query: Query<unknown, unknown, unknown>,
): void => {
	if (shouldEscalate(error, query.meta)) {
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
