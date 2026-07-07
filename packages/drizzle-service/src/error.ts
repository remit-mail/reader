// Re-export the shared error contract so an error thrown by a pg repo is the
// same class the backend handlers and workers already catch (they import these
// from remit-electrodb-service). Defining parallel classes here made
// `instanceof NotFoundError` false across the adapter boundary — a fresh user's
// GET /config surfaced a 404 fatal overlay instead of the empty-config path.
// Imported via the `/error` subpath (a self-contained module) so the pg adapter
// doesn't pull the electrodb models + ddb client into its runtime graph.
export {
	CreateFailedConflictError,
	NotFoundError,
} from "@remit/remit-electrodb-service/error";

export class NotImplementedError extends Error {
	name = "NotImplementedError";
	statusCode = 501;
}

const PG_UNIQUE_VIOLATION = "23505";

// Drizzle wraps the underlying pg error in a DrizzleQueryError and carries the
// original (with its SQLSTATE `code`) on `.cause`, so walk the cause chain.
export const isUniqueViolation = (error: unknown): boolean => {
	let current: unknown = error;
	while (current) {
		if ((current as { code?: string }).code === PG_UNIQUE_VIOLATION) {
			return true;
		}
		current = (current as { cause?: unknown }).cause;
	}
	return false;
};
