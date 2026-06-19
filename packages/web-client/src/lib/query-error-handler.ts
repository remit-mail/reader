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
