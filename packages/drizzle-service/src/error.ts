// Re-export the shared error contract so an error thrown by a pg repo is the
// same class the backend handlers and workers already catch (they import these
// from remit-electrodb-service). Defining parallel classes here made
// `instanceof NotFoundError` false across the adapter boundary — a fresh user's
// GET /config surfaced a 404 fatal overlay instead of the empty-config path.
// Imported via the `/error` subpath (a self-contained module) so the pg adapter
// doesn't pull the electrodb models + ddb client into its runtime graph.
export {
	CreateFailedConflictError,
	ForbiddenError,
	NotFoundError,
} from "@remit/remit-electrodb-service/error";

export class NotImplementedError extends Error {
	name = "NotImplementedError";
	statusCode = 501;
}

const PG_UNIQUE_VIOLATION = "23505";
// better-sqlite3 raises a `SqliteError` whose `.code` is one of these for a
// primary-key or unique-index collision (RFC 036 D1).
const SQLITE_UNIQUE_VIOLATIONS = new Set([
	"SQLITE_CONSTRAINT_UNIQUE",
	"SQLITE_CONSTRAINT_PRIMARYKEY",
]);

// Drizzle wraps the underlying driver error and carries the original (with its
// SQLSTATE / SQLite `code`) on `.cause`, so walk the cause chain — covers both
// the pg and better-sqlite3 drivers.
export const isUniqueViolation = (error: unknown): boolean => {
	let current: unknown = error;
	while (current) {
		const code = (current as { code?: string }).code;
		if (code === PG_UNIQUE_VIOLATION) return true;
		if (code !== undefined && SQLITE_UNIQUE_VIOLATIONS.has(code)) return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
};
