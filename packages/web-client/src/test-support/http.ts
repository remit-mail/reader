/**
 * Fetch seam for the tests. The generated SDK talks to the network through
 * `globalThis.fetch`, so intercepting it — rather than the client module —
 * exercises the real request the app builds: method, path, and JSON body.
 */

export interface HttpCall {
	method: string;
	url: string;
	path: string;
	/** Every request header, lower-cased — a conditional write is one of these. */
	headers: Record<string, string>;
	body: Record<string, unknown> | undefined;
}

export interface HttpMock {
	calls: HttpCall[];
	/** Calls whose path ends with `suffix`, in order. */
	to: (suffix: string) => HttpCall[];
	restore: () => void;
}

type Responder = (call: HttpCall) => unknown;

/**
 * Answer every request with `responder`'s return value as JSON. Throwing from
 * the responder, or returning a `Response`, is how a test drives a failure;
 * returning a promise that never settles is how it drives a request that hangs.
 */
export const mockFetch = (responder: Responder = () => ({})): HttpMock => {
	const original = globalThis.fetch;
	const calls: HttpCall[] = [];

	globalThis.fetch = (async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const request = input instanceof Request ? input : undefined;
		const url = request ? request.url : String(input);
		const rawBody = request ? await request.clone().text() : undefined;
		const headers: Record<string, string> = {};
		const sent = request ? request.headers : new Headers(init?.headers);
		sent.forEach((value, name) => {
			headers[name.toLowerCase()] = value;
		});
		const call: HttpCall = {
			method: (request?.method ?? init?.method ?? "GET").toUpperCase(),
			url,
			path: new URL(url, "http://localhost").pathname,
			headers,
			body: rawBody ? JSON.parse(rawBody) : undefined,
		};
		calls.push(call);

		const result = await responder(call);
		if (result instanceof Response) return result;
		return new Response(JSON.stringify(result ?? {}), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof globalThis.fetch;

	return {
		calls,
		to: (suffix) => calls.filter((call) => call.path.endsWith(suffix)),
		restore: () => {
			globalThis.fetch = original;
		},
	};
};

/**
 * A failed request. The status travels in the body as well as on the response:
 * the generated client throws the parsed body, which the error interceptor
 * re-wraps as an `ApiError` carrying the response status. Anything read off the
 * body — a `code`, its `details` — sits at `.body`, never at the top level.
 */
export const httpError = (status: number, message = "boom"): Response =>
	new Response(JSON.stringify({ status, message }), {
		status,
		headers: { "content-type": "application/json" },
	});
