import type {
	CanonicalMailboxRoleValue,
	FolderRoleUnresolvedReason,
} from "./folder-role.js";

export type { FolderRoleUnresolvedReason };

/**
 * The half of an error a client may read: a stable `code` it branches on and
 * string `details` it words its own prompt from. Opt-in — an error that
 * declares none keeps today's `{ message }` body, so no response gains a
 * shape the API never promised and no internal failure leaks its innards.
 */
export interface PublicApiError {
	code: string;
	details?: Record<string, string>;
}

export const isPublicApiError = (value: unknown): value is PublicApiError => {
	if (typeof value !== "object" || value === null) return false;
	if (!("code" in value) || typeof value.code !== "string") return false;
	if (!("details" in value) || value.details === undefined) return true;
	if (typeof value.details !== "object" || value.details === null) return false;
	return Object.values(value.details).every(
		(detail) => typeof detail === "string",
	);
};

export class HTTPError extends Error {
	public statusCode = 500;
	publicApiError?: PublicApiError;
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
 * A destructive action refused because the role it needs is unresolved. The
 * client reads `code` and words its prompt from `details` — never from the
 * message — so the copy can change without breaking the branch, and the
 * account the prompt has to appoint a folder on travels with the refusal
 * (the delete endpoint's body carries no accountId).
 */
export class FolderRoleUnresolvedError extends ConflictError {
	name = "FolderRoleUnresolvedError";

	constructor(
		message: string,
		role: CanonicalMailboxRoleValue,
		reason: FolderRoleUnresolvedReason,
		accountId: string,
	) {
		super(message);
		this.publicApiError = {
			code: "folder_role_unresolved",
			details: { role, reason, accountId },
		};
	}
}

/**
 * A role cannot be appointed to a mailbox the mail server has not settled yet
 * (imap-mutations R2: wait). Its own code, because the role is not unresolved —
 * the target is: the client words a wait, not a retry. Clearing a role is never
 * refused this way.
 */
export class MailboxNotSettledError extends ConflictError {
	name = "MailboxNotSettledError";

	constructor(message: string, mailboxId: string, syncStatus: string) {
		super(message);
		this.publicApiError = {
			code: "mailbox_not_settled",
			details: { mailboxId, syncStatus },
		};
	}
}

/**
 * Why the row's folder and uid do not name the same message. `in_flight` clears
 * on its own, so the client words a wait; `unverified` does not, so it words a
 * resync instead.
 */
export type MessagePlacementUnsettledReason = "in_flight" | "unverified";

export class MessagePlacementUnsettledError extends ConflictError {
	name = "MessagePlacementUnsettledError";

	constructor(
		message: string,
		accountId: string,
		messageId: string,
		reason: MessagePlacementUnsettledReason,
	) {
		super(message);
		this.publicApiError = {
			code: "message_placement_unsettled",
			details: { accountId, messageId, reason },
		};
	}
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
