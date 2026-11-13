// Re-export the shared error contract so an error thrown by a repo here is the
// same class the backend handlers and workers already catch (they import these
// from @remit/data-ports/errors). Defining parallel classes here made
// `instanceof NotFoundError` false across the adapter boundary — a fresh user's
// GET /config surfaced a 404 fatal overlay instead of the empty-config path.
export {
	CreateFailedConflictError,
	ForbiddenError,
	NotFoundError,
} from "@remit/data-ports/errors";

export class NotImplementedError extends Error {
	name = "NotImplementedError";
	statusCode = 501;
}

// node:sqlite raises an error whose `errcode` is the SQLite extended result
// code: SQLITE_CONSTRAINT_UNIQUE (2067) or SQLITE_CONSTRAINT_PRIMARYKEY (1555)
// for a unique-index or primary-key collision (RFC 036 D1).
const SQLITE_UNIQUE_VIOLATIONS = new Set([2067, 1555]);

// Drizzle wraps the underlying driver error and carries the original (with its
// `errcode`) on `.cause`, so walk the cause chain.
export const isUniqueViolation = (error: unknown): boolean => {
	let current: unknown = error;
	while (current instanceof Error) {
		const errcode: unknown = Reflect.get(current, "errcode");
		if (typeof errcode === "number" && SQLITE_UNIQUE_VIOLATIONS.has(errcode))
			return true;
		current = current.cause;
	}
	return false;
};
