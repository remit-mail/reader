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

/**
 * Classify an error as a fatal first-party server failure that must escalate to
 * the full-screen red overlay.
 *
 * Fatal (true):
 *  - ONLY a genuine 5xx with a real HTTP status from a first-party endpoint
 *    (our API answered, and it answered "I'm broken" — never benign).
 *
 * NOT fatal (false) — expected/transient, soft-handled by the calling surface
 * or recovered by React Query's reconnect/retry:
 *  - 4xx (404 no-data, 401/403 auth, 409 conflict, 422 validation, 429);
 *  - a statusless transport/network failure (`TypeError: Failed to fetch` from a
 *    wifi drop, tab wake, captive portal, or a background refetch) — the request
 *    never reached a server, so it is indistinguishable from a connectivity blip
 *    and must NOT take over the screen behind a reload-only overlay (reload also
 *    fails while offline → user trapped). React Query's reconnect refetch
 *    recovers these;
 *  - an aborted/cancelled request (route change, React Query cancellation);
 *  - an empty result set (not an error at all).
 */
export const isFatalServerError = (error: unknown): boolean => {
	if (isAbortError(error)) return false;

	const status = getErrorStatus(error);
	// No HTTP status means the request never got a server answer: a connectivity
	// blip or transport failure, not a proven first-party 5xx. Treat it as soft
	// and let React Query's reconnect/retry recover — never escalate.
	if (status === undefined) return false;

	return status >= 500 && status <= 599;
};

const isAbortError = (error: unknown): boolean => {
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
