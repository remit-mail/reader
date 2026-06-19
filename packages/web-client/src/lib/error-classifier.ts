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
 *  - any 5xx from a first-party endpoint (our API is broken — never benign);
 *  - a network/transport failure with no HTTP status that is not an explicit
 *    request abort (the request never reached a server, or the response was
 *    unreadable — indistinguishable from our backend being down).
 *
 * NOT fatal (false) — expected, soft-handled by the calling surface:
 *  - 4xx (404 no-data, 401/403 auth, 409 conflict, 422 validation, 429);
 *  - an aborted/cancelled request (route change, React Query cancellation);
 *  - an empty result set (not an error at all).
 */
export const isFatalServerError = (error: unknown): boolean => {
	if (isAbortError(error)) return false;

	const status = getErrorStatus(error);
	if (status === undefined) {
		// No HTTP status: a transport/network failure. Our backend being
		// unreachable is a fatal first-party condition, not an expected 4xx.
		return isLikelyNetworkError(error);
	}

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

/**
 * A thrown `Error` with no HTTP status that looks like a transport failure
 * (e.g. `TypeError: Failed to fetch`). We treat these as fatal because, from
 * the UI's perspective, an unreachable first-party API is as broken as a 5xx.
 */
const isLikelyNetworkError = (error: unknown): boolean => {
	return error instanceof Error;
};
