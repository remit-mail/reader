/**
 * Parse JSON in a Promise so a malformed string surfaces as a rejection the
 * caller can `.catch()`, instead of a synchronous throw that would need a block
 * try/catch. Use only where an unparseable value is an expected, recoverable
 * absence (e.g. a third-party token, a dev-server response body) — never to
 * soften an internal contract, which must stay a fatal uncaught `JSON.parse`.
 */
export const safeJsonParse = <T>(raw: string): Promise<T> =>
	new Promise((resolve) => {
		resolve(JSON.parse(raw));
	});
