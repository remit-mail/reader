export class HTTPError extends Error {
	public statusCode = 500;
}

export class BadRequestError extends HTTPError {
	name = "BadRequestError";
	public statusCode = 400;
}

export class ClientError extends HTTPError {
	name = "ClientError";
	public statusCode = 401;
}

export class ForbiddenError extends HTTPError {
	name = "ForbiddenError";
	public statusCode = 403;
}

export class NotFoundError extends HTTPError {
	name = "NotFoundError";
	public statusCode = 404;
}

export class ConflictError extends HTTPError {
	name = "ConflictError";
	public statusCode = 409;
}

/**
 * A message exists but its body could not be fetched/parsed after every
 * body-sync retry was spent (issue #1270 / epic #1281 invariant 3). This is
 * distinct from `NotFoundError`: the message is real, but its content is
 * permanently unavailable — the client must show an explicit, actionable
 * error instead of retrying (no 202, no silent skip).
 */
export class UnrecoverableBodyError extends HTTPError {
	name = "UnrecoverableBodyError";
	public statusCode = 422;
}

export class CreateFailedConflictError extends ConflictError {
	public statusCode = 409;
	name = "CreateFailedConflictError";
	constructor(resourceType: string, params: unknown) {
		super(
			`${resourceType} with properties "${JSON.stringify(params)}" already exists.`,
		);
	}
}

export class UnhandledError extends HTTPError {
	name = "UnhandledError";
	public statusCode = 500;
	readonly cause: Error | undefined;

	constructor(message: string, cause?: Error) {
		super(message);
		this.message = message;
		if (cause) this.cause = cause;
	}

	toJSON() {
		return {
			message: this.message,
			cause: this.cause?.message,
			stack: this.cause?.stack || this.stack,
		};
	}
}

export class InternalServerError extends UnhandledError {
	name = "InternalServerError";
	public statusCode = 500;
}
