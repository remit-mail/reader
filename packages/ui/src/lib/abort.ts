/**
 * True for the rejection an aborted `AbortSignal` produces (a `DOMException`
 * named `AbortError`, or any error carrying that name). A create affordance that
 * is unmounted or cancelled aborts its in-flight folder create; the rejection is
 * expected, not a failure to show — the surface is already gone.
 */
export const isAbortError = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"name" in error &&
	(error as { name?: unknown }).name === "AbortError";
