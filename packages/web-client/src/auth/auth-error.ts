import { getErrorStatus, isAbortError } from "@/lib/error-classifier";
import { reportFatalError } from "@/lib/fatal-error";

/**
 * How an auth (better-auth) failure should surface.
 *
 *  - "network"    — the request never reached the server (offline / unreachable).
 *                   Inline, correctable by the user: check the connection.
 *  - "validation" — an expected, user-correctable rejection the server
 *                   described (email already registered, weak password, wrong
 *                   credentials). Inline, surfacing the server's own message.
 *  - "fatal"      — a 404, or any other unexpected 4xx/5xx from our own API. The
 *                   deployment or the client/server contract is broken and there
 *                   is nothing the user can retry their way out of. Escalates to
 *                   the full-screen fatal page with a bug-report link.
 */
export type AuthErrorClass = "network" | "validation" | "fatal";

/** The request being attempted, for a fatal report that names method and path. */
export interface AuthRequest {
	method: string;
	path: string;
}

/** better-auth's client sentinel for a fetch that never got an HTTP response. */
const FETCH_ERROR_STATUS_TEXT = "Fetch Error";

const readString = (error: unknown, key: string): string | undefined => {
	if (error && typeof error === "object" && key in error) {
		const value = (error as Record<string, unknown>)[key];
		if (typeof value === "string" && value.trim().length > 0) return value;
	}
	return undefined;
};

/** The human message better-auth attaches to a known, expected rejection. */
export const authServerMessage = (error: unknown): string | undefined =>
	readString(error, "message");

const isNetworkFailure = (error: unknown): boolean => {
	if (isAbortError(error)) return false;
	if (readString(error, "statusText") === FETCH_ERROR_STATUS_TEXT) return true;
	return getErrorStatus(error) === undefined;
};

/**
 * Sort an auth failure into how it should surface. A 404 or any other
 * unexpected 4xx/5xx from our own API is fatal — a broken deployment or
 * contract, not something a retry fixes. Only a statusless connectivity failure
 * or an expected, server-described rejection stays inline.
 */
export const classifyAuthError = (error: unknown): AuthErrorClass => {
	if (isNetworkFailure(error)) return "network";
	const status = getErrorStatus(error);
	if (status === undefined) return "fatal";
	if (status === 404 || status >= 500) return "fatal";
	if (authServerMessage(error)) return "validation";
	return "fatal";
};

const NETWORK_MESSAGE =
	"Can't reach the server. You may be offline — check your connection and try again.";

/** The inline banner text for a network or validation failure. */
export const authInlineMessage = (
	error: unknown,
	kind: AuthErrorClass,
): string => {
	if (kind === "network") return NETWORK_MESSAGE;
	return authServerMessage(error) ?? "Please check your details and try again.";
};

const statusSummary = (error: unknown): string => {
	const status = getErrorStatus(error);
	if (status === undefined) return "no response";
	const statusText = readString(error, "statusText");
	return statusText ? `${status} ${statusText}` : String(status);
};

/** The message shown on the fatal page and prefilled into the bug report. */
export const buildFatalAuthMessage = (
	error: unknown,
	request: AuthRequest,
): string => {
	const summary = statusSummary(error);
	const guidance =
		getErrorStatus(error) === 404
			? "The endpoint did not respond as expected — check that the backend is running and up to date (see the deployment guide's troubleshooting section)."
			: "The server returned an unexpected response.";
	const server = authServerMessage(error);
	const serverLine = server ? ` Server said: ${server}.` : "";
	return `${request.method} ${request.path} failed: ${summary}. ${guidance}${serverLine}`;
};

/**
 * Escalate an unexpected auth failure to the full-screen fatal page. The message
 * names the method, path, and status; the overlay carries the bug-report link.
 * Not recoverable — a broken route or contract does not resolve on retry.
 */
export const reportFatalAuthError = (
	error: unknown,
	request: AuthRequest,
): void => {
	reportFatalError(new Error(buildFatalAuthMessage(error, request)), {
		recoverable: false,
	});
};
