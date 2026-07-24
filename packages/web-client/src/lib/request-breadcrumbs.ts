/**
 * A constant-size ring of the last few API calls, captured at the one fetch
 * choke point (`taggedFetch` in network-error.ts). It gives a bug report the
 * request context that a minified stack cannot: which endpoints were hit, in
 * what order, and what they returned — plus the correlation id that ties a
 * failing request to its server-side log line.
 *
 * PRIVACY — the issue tracker is public, so a breadcrumb is METADATA ONLY.
 * Capture records the request method, the URL PATHNAME, the HTTP status, the
 * duration, and a correlation id. It never records a request or response body,
 * and never the query string — a search's `?q=` carries the user's query text,
 * a message fetch's params can carry a subject. `requestPath` strips the query
 * and hash precisely so none of that can reach the report even when the fetch
 * layer has the full URL in hand. Opaque path ids (a message id in the path)
 * are acceptable: they already appear in the report's URL section.
 *
 * Capture is cheap by construction — a fixed-size array of small records, no
 * serialization until a report is assembled.
 */

export interface RequestBreadcrumb {
	method: string;
	/** URL pathname only — never the query string or hash (see file header). */
	path: string;
	/** HTTP status, or 0 when the request never reached a server (transport failure). */
	status: number;
	durationMs: number;
	/** Server correlation id from a response header, when the response carried one. */
	correlationId?: string;
	timestamp: string;
}

const MAX_ENTRIES = 10;

const ring: RequestBreadcrumb[] = [];

/**
 * Response headers that carry a request/trace correlation id, in preference
 * order. `Headers.get` is case-insensitive, so the lowercase form matches
 * whatever casing the server sent.
 */
const CORRELATION_HEADERS = [
	"x-correlation-id",
	"x-request-id",
	"x-amzn-requestid",
	"x-amzn-trace-id",
	"apigw-requestid",
	"x-trace-id",
] as const;

/**
 * The pathname of a request, with the query string and hash discarded. This is
 * the redaction boundary: it is the only thing that reads the request URL, and
 * it deliberately keeps nothing but the path so no query text can leak into a
 * breadcrumb.
 */
export function requestPath(input: RequestInfo | URL): string {
	const raw =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url;
	try {
		return new URL(raw, window.location.origin).pathname;
	} catch {
		// A non-URL input (rare) still must not leak a query — cut at the first
		// `?` or `#` and return what precedes it.
		return raw.split(/[?#]/)[0];
	}
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
	if (init?.method) return init.method.toUpperCase();
	if (typeof input !== "string" && !(input instanceof URL) && input.method) {
		return input.method.toUpperCase();
	}
	return "GET";
}

function correlationIdFrom(response: Response): string | undefined {
	for (const header of CORRELATION_HEADERS) {
		const value = response.headers.get(header);
		if (value) return value;
	}
	return undefined;
}

function push(entry: RequestBreadcrumb): void {
	ring.push(entry);
	if (ring.length > MAX_ENTRIES) ring.shift();
}

/**
 * Record the outcome of one fetch. Called from `taggedFetch` for both a
 * completed response and a transport failure (no response, status 0). Only the
 * metadata listed in `RequestBreadcrumb` is read — never `init.body` or the
 * response body.
 */
export function recordRequest(args: {
	input: RequestInfo | URL;
	init?: RequestInit;
	response?: Response;
	durationMs: number;
}): void {
	const { input, init, response, durationMs } = args;
	push({
		method: requestMethod(input, init),
		path: requestPath(input),
		status: response?.status ?? 0,
		durationMs: Math.round(durationMs),
		correlationId: response ? correlationIdFrom(response) : undefined,
		timestamp: new Date().toISOString(),
	});
}

/** The captured breadcrumbs, oldest first. A copy — callers cannot mutate the ring. */
export function getRecentRequests(): readonly RequestBreadcrumb[] {
	return ring.slice();
}

/**
 * The most recent request that failed — a transport failure (status 0) or an
 * HTTP error (>= 400). This is the request a report should call out explicitly,
 * so nobody has to decode a minified stack to learn what broke.
 */
export function getFailingRequest(): RequestBreadcrumb | undefined {
	for (let i = ring.length - 1; i >= 0; i--) {
		const entry = ring[i];
		if (entry.status === 0 || entry.status >= 400) return entry;
	}
	return undefined;
}

/** Test-only: clear the ring. */
export function __resetRequestBreadcrumbs(): void {
	ring.length = 0;
}
