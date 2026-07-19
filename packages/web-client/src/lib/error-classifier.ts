import { ApiError } from "./api";
import { NetworkError } from "./network-error";

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

const isOffline = (): boolean =>
	typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * A transport failure from a wifi drop, tab wake, captive portal, or a timeout:
 * the request never reached a server, so it is environmental, not a proven
 * first-party failure.
 *
 * This is decided at the fetch boundary, not inferred here. Every app-owned
 * request goes through `taggedFetch`, which knows a `fetch()` rejection is
 * transport-level because `fetch` rejects for no other reason, and tags it a
 * `NetworkError`. Reading that tag is exact; matching browser failure strings
 * was not — the list is open-ended (WebKit alone has four, undici another) and
 * anything missed would put a full-screen fatal page in front of someone who
 * had merely walked out of wifi range.
 *
 * `navigator.onLine === false` is kept as a second signal for an error that
 * reached us from outside that boundary while the browser reports no
 * connectivity at all.
 */
export const isNetworkError = (error: unknown): boolean => {
	if (isAbortError(error)) return false;
	if (hasHttpStatus(error)) return false;
	if (error instanceof NetworkError) return true;
	return isOffline();
};

/**
 * An exception raised by our own client code rather than by a request: it
 * carries no HTTP status, is not an abort, and was not tagged as transport.
 * That leaves a programming error — the one class the user can do nothing
 * about and must never be asked to shrug off.
 */
export const isClientBug = (error: unknown): boolean =>
	!hasHttpStatus(error) && !isAbortError(error) && !isNetworkError(error);

/**
 * Fatal with no opt-out: our API answered "I'm broken", or our own code threw.
 * Neither is something a call site can reclassify as soft, and neither may be
 * reduced to a dismissible banner — both belong on the full-screen page, which
 * offers a way forward and a bug report (issue #55).
 */
export const isAlwaysFatal = (error: unknown): boolean =>
	isServerError(error) || isClientBug(error);

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
 *  3. A client-side exception ALWAYS escalates, on the same terms. It is our
 *     bug; there is nothing for the user to retry and nothing to dismiss.
 *  4. The ONLY soft (do-NOT-escalate) exemptions:
 *     a. aborts / cancellations — never a failure;
 *     b. network/offline errors — environmental, recovered by React Query's
 *        reconnect/retry;
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
	if (isAlwaysFatal(error)) return true;
	if (isSoftErrorMeta(meta)) return false;
	return true;
};
