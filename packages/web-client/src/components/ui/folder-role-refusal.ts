/**
 * The coded 409 a destructive action is refused with when the folder role it
 * needs is unsettled (#887). Read the `code`, never the message: the copy is
 * free to change and a message-string match would silently start opening the
 * appointment prompt over an unrelated conflict. A 409 without one of these
 * codes is somebody else's error and keeps today's banner.
 */
import type {
	ApiError,
	RemitImapCanonicalMailboxRole,
} from "@remit/api-http-client/types.gen.ts";
import { CanonicalMailboxRole } from "@remit/domain-enums";

/** Why the role is unresolved, as the API's `details.reason` spells it. */
export type FolderRoleRefusalReason = "none" | "stale" | "unconfirmed";

/** `FolderRoleConflict`'s `details`, narrowed to the values the prompt needs. */
export interface FolderRoleRefusal {
	reason: FolderRoleRefusalReason;
	role: RemitImapCanonicalMailboxRole;
	accountId: string;
}

const REASONS: ReadonlySet<string> = new Set<FolderRoleRefusalReason>([
	"none",
	"stale",
	"unconfirmed",
]);

const ROLES: ReadonlySet<string> = new Set(Object.values(CanonicalMailboxRole));

/**
 * The wire body as `handleError` emits it — flat, so `code` and `details` sit
 * at the top level. Everything is re-checked at runtime: this is a network
 * boundary, and the type only says what the contract promises.
 */
const bodyOf = (error: unknown): Partial<ApiError> | undefined =>
	typeof error === "object" && error !== null
		? (error as Partial<ApiError>)
		: undefined;

const stringAt = (
	details: ApiError["details"],
	key: string,
): string | undefined => {
	const value = details?.[key];
	return typeof value === "string" ? value : undefined;
};

/**
 * The refusal, or `undefined` for every other failure. Every fact the prompt
 * needs travels with it: the account to appoint on (the delete endpoint's body
 * carries none), the role, and the reason, which decides the framing.
 */
export const isFolderRoleRefusal = (
	error: unknown,
): FolderRoleRefusal | undefined => {
	const body = bodyOf(error);
	if (body?.code !== "folder_role_unresolved") return undefined;
	const { details } = body;
	if (typeof details !== "object" || details === null) return undefined;
	const reason = stringAt(details, "reason");
	const role = stringAt(details, "role");
	const accountId = stringAt(details, "accountId");
	if (!reason || !REASONS.has(reason)) return undefined;
	if (!role || !ROLES.has(role) || !accountId) return undefined;
	return {
		reason: reason as FolderRoleRefusalReason,
		role: role as RemitImapCanonicalMailboxRole,
		accountId,
	};
};

/**
 * The appointment write's own refusal: the mailbox is still being created or
 * deleted on the mail server, so it cannot hold a role yet. A different
 * sentence with a different remedy from a network failure — waiting fixes this
 * one, retrying does not.
 */
export const isMailboxNotSettledRefusal = (error: unknown): boolean =>
	bodyOf(error)?.code === "mailbox_not_settled";
