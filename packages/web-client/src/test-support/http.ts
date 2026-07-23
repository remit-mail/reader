/**
 * Fetch seam for the tests. The generated SDK talks to the network through
 * `globalThis.fetch`, so intercepting it — rather than the client module —
 * exercises the real request the app builds: method, path, and JSON body.
 */

export interface HttpCall {
	method: string;
	url: string;
	path: string;
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
 * the responder, or returning a `Response`, is how a test drives a failure.
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
		const call: HttpCall = {
			method: (request?.method ?? init?.method ?? "GET").toUpperCase(),
			url,
			path: new URL(url, "http://localhost").pathname,
			body: rawBody ? JSON.parse(rawBody) : undefined,
		};
		calls.push(call);

		const result = responder(call);
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
 * the generated client throws the parsed body, and the app's error classifier
 * reads the status off it.
 */
export const httpError = (status: number, message = "boom"): Response =>
	new Response(JSON.stringify({ status, message }), {
		status,
		headers: { "content-type": "application/json" },
	});
