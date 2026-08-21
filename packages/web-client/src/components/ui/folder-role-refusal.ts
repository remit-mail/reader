/**
 * The coded 409 a destructive action is refused with when the folder role it
 * needs is unsettled (#887). Read the `code`, never the message: the copy is
 * free to change and a message-string match would silently start opening the
 * appointment prompt over an unrelated conflict. A 409 without one of these
 * codes is somebody else's error and keeps today's banner.
 */

/** Why the role is unresolved, as the API's `details.reason` spells it. */
export type FolderRoleRefusalReason = "none" | "stale" | "unconfirmed";

export interface FolderRoleRefusal {
	reason: FolderRoleRefusalReason;
	role: string;
	accountId: string;
}

const REASONS: ReadonlySet<string> = new Set(["none", "stale", "unconfirmed"]);

const bodyOf = (error: unknown): Record<string, unknown> | undefined =>
	typeof error === "object" && error !== null
		? (error as Record<string, unknown>)
		: undefined;

const detailsOf = (
	body: Record<string, unknown>,
): Record<string, unknown> | undefined => {
	const { details } = body;
	if (typeof details !== "object" || details === null) return undefined;
	return details as Record<string, unknown>;
};

const stringAt = (
	details: Record<string, unknown>,
	key: string,
): string | undefined => {
	const value = details[key];
	return typeof value === "string" ? value : undefined;
};

/**
 * The refusal, or `undefined` for every other failure. Both facts the prompt
 * needs travel with it: the account to appoint on (the delete endpoint's body
 * carries none) and the reason, which decides the framing.
 */
export const isFolderRoleRefusal = (
	error: unknown,
): FolderRoleRefusal | undefined => {
	const body = bodyOf(error);
	if (body?.code !== "folder_role_unresolved") return undefined;
	const details = detailsOf(body);
	if (!details) return undefined;
	const reason = stringAt(details, "reason");
	const role = stringAt(details, "role");
	const accountId = stringAt(details, "accountId");
	if (!reason || !REASONS.has(reason) || !role || !accountId) return undefined;
	return { reason: reason as FolderRoleRefusalReason, role, accountId };
};

/**
 * The appointment write's own refusal: the mailbox is still being created or
 * deleted on the mail server, so it cannot hold a role yet. A different
 * sentence with a different remedy from a network failure — waiting fixes this
 * one, retrying does not.
 */
export const isMailboxNotSettledRefusal = (error: unknown): boolean =>
	bodyOf(error)?.code === "mailbox_not_settled";
