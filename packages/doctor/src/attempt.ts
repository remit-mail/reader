/**
 * Turn a failure into a value.
 *
 * Used only where the design says a failure IS the signal: an endpoint that
 * refuses the connection, a heartbeat directory that cannot be read. Those are
 * facts the verdict has to carry, and a checker that propagates the first one
 * reports nothing about everything else it looked at — which is the outcome
 * "a signal that cannot be evaluated is degraded, never skipped" rules out.
 *
 * Everywhere else in this package, errors propagate.
 */
export type Attempt<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: string };

export const describeError = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const attempt = <T>(work: Promise<T>): Promise<Attempt<T>> =>
	work.then(
		(value) => ({ ok: true, value }) as const,
		(error: unknown) => ({ ok: false, error: describeError(error) }) as const,
	);

/**
 * `JSON.parse` in a promise, so a malformed document is a rejection a caller
 * can `.catch()` rather than a synchronous throw needing a block try/catch.
 * Same shape as the backend's own helper; written here because this package
 * deliberately depends on nothing.
 */
export const safeJsonParse = <T>(raw: string): Promise<T> =>
	new Promise((resolve) => {
		resolve(JSON.parse(raw));
	});
