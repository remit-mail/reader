import { ApiError } from "./api";

/**
 * Extract an HTTP status code from a thrown error, regardless of which client
 * raised it.
 *
 * Two client shapes coexist in the web client:
 *  - the hand-written `api` wrapper throws `ApiError` (carries `.status`);
 *  - the generated `@remit/api-http-client` (hey-api) throws the parsed JSON error
 *    body. A response interceptor (see `lib/client.ts`) re-wraps those as
 *    `ApiError` too, so in practice both paths carry `.status`. As a belt-and-
 *    braces fallback we also read a numeric `status`/`statusCode` off a plain
 *    object.
 */
export const getErrorStatus = (error: unknown): number | undefined => {
	if (error instanceof ApiError) return error.status;
	if (error && typeof error === "object") {
		const candidate = error as { status?: unknown; statusCode?: unknown };
		if (typeof candidate.status === "number") return candidate.status;
		if (typeof candidate.statusCode === "number") return candidate.statusCode;
	}
	return undefined;
};

/** The error carries a real HTTP status — our API answered. */
export const hasHttpStatus = (error: unknown): boolean =>
	getErrorStatus(error) !== undefined;

/** A genuine first-party server failure: an HTTP 5xx. */
export const isServerError = (error: unknown): boolean => {
	const status = getErrorStatus(error);
	return status !== undefined && status >= 500 && status <= 599;
};

/**
 * A deliberately cancelled request (route change, React Query cancellation).
 * Never a failure.
 */
export const isAbortError = (error: unknown): boolean => {
	if (
		typeof DOMException !== "undefined" &&
		error instanceof DOMException &&
		error.name === "AbortError"
	) {
		return true;
	}
	if (
		error &&
		typeof error === "object" &&
		"name" in error &&
		(error as { name?: unknown }).name === "AbortError"
	) {
		return true;
	}
	return false;
};

/**
 * A statusless transport/network failure (`TypeError: Failed to fetch` from a
 * wifi drop, tab wake, captive portal, or a background refetch): the request
 * never reached a server, so it is environmental, not a proven first-party
 * failure. Excludes deliberate aborts (also statusless, but their own category).
 */
export const isNetworkError = (error: unknown): boolean =>
	!isAbortError(error) && !hasHttpStatus(error);

const isSoftErrorMeta = (meta: Record<string, unknown> | undefined): boolean =>
	meta?.softError === true;

/**
 * The single fail-fast decision: should this error escalate to the full-screen
 * fatal overlay? Default is YES — a non-2xx must never silently vanish.
 *
 * The contract (issue #1059):
 *  1. DEFAULT = escalate.
 *  2. A 5xx (500–599) ALWAYS escalates — no opt-out, even on a background
 *     refetch, even when the call site marked `meta.softError`. Our API
 *     answered "I'm broken"; that is never benign.
 *  3. The ONLY soft (do-NOT-escalate) exemptions:
 *     a. aborts / cancellations — never a failure;
 *     b. statusless network/offline errors — environmental, recovered by React
 *        Query's reconnect/retry;
 *     c. a non-5xx error on a query/mutation that opted out via
 *        `meta.softError === true` — the call site owns that error's UX
 *        (e.g. a 404 empty state, a 4xx "Reconnect" banner).
 */
export const shouldEscalate = (
	error: unknown,
	meta?: Record<string, unknown>,
): boolean => {
	if (isServerError(error)) return true;
	if (isAbortError(error)) return false;
	if (isNetworkError(error)) return false;
	if (isSoftErrorMeta(meta)) return false;
	return true;
};
