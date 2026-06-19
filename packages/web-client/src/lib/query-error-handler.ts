import type { Query } from "@tanstack/react-query";
import { isFatalServerError } from "./error-classifier";
import { reportFatalError } from "./fatal-error";

/**
 * Global React Query error sink. Every query and mutation error flows through
 * here (wired on the `QueryCache`/`MutationCache` in main.tsx). Fatal first-party
 * failures (5xx / unreachable backend) escalate to the full-screen red overlay
 * via `reportFatalError`; everything else (4xx, aborts) is left to the calling
 * surface to handle softly.
 *
 * This is the v5 equivalent of `defaultOptions.queries.onError` — v5 moved the
 * global error hook onto the caches.
 */
export const handleQueryError = (error: unknown): void => {
	if (isFatalServerError(error)) {
		reportFatalError(error);
	}
};

/**
 * `QueryCache.onError` variant. Same fatal classification, but only escalates a
 * 5xx that breaks the *initial* load of a query (`dataUpdatedAt === 0` — the
 * screen has nothing to show). A routine stale background refetch that 5xxes on
 * an already-rendered screen keeps the cached data visible (the calling surface
 * handles the soft signal); blanking the whole app behind a reload-only overlay
 * for a transient refetch blip is the over-fire we are killing.
 */
export const handleQueryCacheError = (
	error: Error,
	query: Query<unknown, unknown, unknown, readonly unknown[]>,
): void => {
	if (query.state.dataUpdatedAt !== 0) return;
	handleQueryError(error);
};
