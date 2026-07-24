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
 * A query the user did not trigger: a passive background poll or interval/focus
 * refetch (config, the outbox list). Declared per query via
 * `meta.backgroundPoll === true` — parallel to `meta.softError` — and attached
 * centrally with `setQueryDefaults` in the shell, so every observer of those
 * keys inherits it. Never set on a mutation: a mutation is a user-initiated
 * write, so it keeps the default #1059 escalation.
 */
export const isBackgroundPoll = (
	meta: Record<string, unknown> | undefined,
): boolean => meta?.backgroundPoll === true;

/**
 * Consecutive failed background polls before a quiet degrade becomes a visible
 * fatal. Below this a transient blip stays silent and is retried; at or above
 * it the poll has failed long enough to be a real outage, which must surface
 * rather than be swallowed forever. The counting is per-query, reset on the
 * poll's next success (see `query-error-handler.ts`).
 */
export const BACKGROUND_POLL_ESCALATION_THRESHOLD = 3;

/** Extra signals the caller derives from the failing query. */
export interface EscalationContext {
	/**
	 * Consecutive failures of a background poll, counted since its last success.
	 * Only consulted for a `meta.backgroundPoll` 5xx: it lets a persistent outage
	 * escalate while a single transient blip stays quiet. Absent (or `1`) means
	 * "first failure in the streak".
	 */
	consecutiveFailures?: number;
}

/**
 * The single fail-fast decision: should this error escalate to the full-screen
 * fatal overlay? Default is YES — a non-2xx must never silently vanish.
 *
 * The contract (issues #1059, #225):
 *  1. DEFAULT = escalate.
 *  2. A 5xx (500–599) escalates — no opt-out via `meta.softError`. Our API
 *     answered "I'm broken"; that is never benign.
 *  3. A client-side exception ALWAYS escalates, on the same terms — background
 *     poll or not. It is our bug; there is nothing for the user to retry and
 *     nothing to dismiss.
 *  4. EXCEPTION to rule 2 — a background poll (`meta.backgroundPoll === true`),
 *     the passive config/outbox refetch the user did not trigger: a transient
 *     5xx stays quiet and is retried, and only escalates once it has failed
 *     `BACKGROUND_POLL_ESCALATION_THRESHOLD` consecutive times (a real outage,
 *     not a ~1s deploy blip — #225). A user-initiated query or any mutation is
 *     not a background poll and still escalates on the first 5xx.
 *  5. The other soft (do-NOT-escalate) exemptions:
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
	context?: EscalationContext,
): boolean => {
	if (isAbortError(error)) return false;
	if (isNetworkError(error)) return false;
	if (isClientBug(error)) return true;

	if (isServerError(error)) {
		if (isBackgroundPoll(meta)) {
			const failures = context?.consecutiveFailures ?? 1;
			return failures >= BACKGROUND_POLL_ESCALATION_THRESHOLD;
		}
		return true;
	}

	if (isSoftErrorMeta(meta)) return false;
	return true;
};
