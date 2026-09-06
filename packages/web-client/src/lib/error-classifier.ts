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

/**
 * The session is gone. Not 403: a handler answers 403 for a resource belonging
 * to another account config, which is a refusal a call site can state where it
 * stands. A 401 is the user signed out from under whatever they were doing.
 */
export const isUnauthenticated = (error: unknown): boolean =>
	getErrorStatus(error) === 401;

/**
 * Who is waiting on this request's answer. One decision turns on it, and only
 * one: whether a 401 overrides the call site's own `meta.softError`.
 *
 * "user" — the user did something and the app owes them the outcome. Every
 * mutation is this, the debounced autosave included: it carries text that is on
 * screen, and if it is refused for want of a session then so is the send behind
 * it. No banner a call site can render signs anyone back in, so this is the one
 * 4xx a call site may not keep to itself.
 *
 * "nobody" — a poll, a prefetch, a best-effort background trigger, an inline
 * sub-resource with an error surface of its own. A 401 there is not news the
 * app may take the whole screen for, and `meta.softError` decides as usual.
 *
 * Reads are "nobody" as a class, which is not the same as saying no read
 * matters: a read the screen is actually waiting on has no `meta.softError` on
 * it, so rule 1 escalates it anyway. The only reads this spares are the ones
 * that already declared they own their failures — the update poll mounted at
 * the app root, the message body with its own inline banner. Escalating those
 * put the full-screen page over every screen in the app.
 */
export type Awaiting = "user" | "nobody";

const isSoftErrorMeta = (
	error: unknown,
	meta: Record<string, unknown> | undefined,
): boolean => {
	if (meta?.softError === true) return true;
	const owned = meta?.softErrorStatuses;
	if (!Array.isArray(owned)) return false;
	const status = getErrorStatus(error);
	return status !== undefined && owned.includes(status);
};

/**
 * The statuses answered for the seconds a service is not there. Every `/api/*`
 * request is proxied to apisix, which stays up while the backend behind it
 * restarts and refuses in milliseconds — the 29ms 502 in #468, not a dial Caddy
 * waited out. 503 and 504 are the same gap through a hop that answers
 * differently.
 */
const RESTART_GAP_STATUSES = [502, 503, 504];

/**
 * The gap in a restart this call site asked for. A self-update stops and starts
 * the backend on purpose, so the poll watching that run meets a proxy with
 * nothing behind it — the designed shape of the operation the user pressed, not
 * our API answering "I'm broken".
 *
 * A 500 is not in it: a server that answered is a server that is up, and up and
 * broken is never designed.
 */
const isDesignedRestartGap = (
	error: unknown,
	meta: Record<string, unknown> | undefined,
): boolean => {
	if (meta?.restartExpected !== true) return false;
	const status = getErrorStatus(error);
	return status !== undefined && RESTART_GAP_STATUSES.includes(status);
};

/**
 * The single fail-fast decision: should this error escalate to the full-screen
 * fatal overlay? Default is YES — a non-2xx must never silently vanish.
 *
 * The contract (issue #1059):
 *  1. DEFAULT = escalate.
 *  2. A 5xx (500–599) ALWAYS escalates — no opt-out, even on a background
 *     refetch, even when the call site marked `meta.softError`. Our API
 *     answered "I'm broken"; that is never benign. The single exception is a
 *     502/503/504 on a call site that declared it is polling across a restart it
 *     asked for (`meta.restartExpected`, #468): there the backend being gone is
 *     the operation working, and that call site renders the wait itself.
 *  3. A client-side exception ALWAYS escalates, on the same terms. It is our
 *     bug; there is nothing for the user to retry and nothing to dismiss.
 *  4. A 401 on a request the user is waiting on ALWAYS escalates, on the same
 *     terms. Dismissing it leaves them signed out with no way back in, and a
 *     send that keeps failing becomes a loop with no exit — `BetterAuthShell`
 *     re-gates only when `useSession()` revalidates, which a banner never makes
 *     happen. See `Awaiting` for what nobody waiting on it means.
 *  5. The ONLY soft (do-NOT-escalate) exemptions:
 *     a. aborts / cancellations — never a failure;
 *     b. network/offline errors — environmental, recovered by React Query's
 *        reconnect/retry;
 *     c. a non-5xx error on a query/mutation that opted out via
 *        `meta.softError === true` — the call site owns that error's UX
 *        (e.g. a 404 empty state, a 4xx "Reconnect" banner) — or, where it owns
 *        one status and not the rest, `meta.softErrorStatuses`.
 */
export const shouldEscalate = (
	error: unknown,
	meta?: Record<string, unknown>,
	awaiting: Awaiting = "nobody",
): boolean => {
	if (isServerError(error)) return !isDesignedRestartGap(error, meta);
	if (isAbortError(error)) return false;
	if (isNetworkError(error)) return false;
	if (awaiting === "user" && isUnauthenticated(error)) return true;
	if (isAlwaysFatal(error)) return true;
	if (isSoftErrorMeta(error, meta)) return false;
	return true;
};

/**
 * The meta a call site sets to keep its own non-5xx failures off the
 * full-screen fatal page, because it renders them itself — a banner, a retry,
 * an empty state. Rules 2, 3 and 4 above still win: a 5xx, a client-side
 * exception, and a 401 on something the user is waiting on, escalate regardless.
 *
 * Two classes of call site must always carry it. One is a request the user
 * never asked for and is not waiting on — a debounced autosave, a
 * dwell-triggered mark-as-read: a refusal there is not news worth stopping the
 * app for. The other is any surface holding text the user has not finished
 * writing. The fatal page unmounts the app, so escalating from a composer
 * throws the message away and leaves nothing to retry, which is a worse outcome
 * than the failure it reports.
 */
export const softErrorMeta: { softError: true } = { softError: true };

/**
 * The narrow form, for a call site that owns one outcome and none of the others.
 * A read whose record may legitimately be gone owns the 404 and nothing else: a
 * blanket `softErrorMeta` there would also swallow the 401 and the 403, and a
 * background read that answers a lapsed session with nothing leaves the user
 * looking at a screen that has quietly stopped working.
 */
export const softErrorStatuses = (
	...statuses: number[]
): { softErrorStatuses: number[] } => ({ softErrorStatuses: statuses });

/**
 * The one opt-out from rule 2, for a request watching a restart the run it is
 * following performs. Set it only while a run is known to be in flight — the
 * update poll carries it while it holds a run it started or the server's last
 * answer reported one going — because a 502 outside that window is the API being
 * broken, which is exactly what rule 2 is for.
 *
 * A call site that sets this owns the whole wait, so the window outlives the
 * budget: the give-up screen keeps polling a server it has stopped expecting,
 * and a fatal page thrown over that verdict would replace the one screen that
 * names the run and the log to read. A 500 from that same poll still escalates.
 */
export const restartExpectedMeta: { restartExpected: true } = {
	restartExpected: true,
};

/** The record is not there. */
export const isNotFound = (error: unknown): boolean =>
	getErrorStatus(error) === 404;
