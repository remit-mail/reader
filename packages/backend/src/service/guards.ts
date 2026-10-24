import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import type { Refusal } from "./outcome.js";

/**
 * Cross-tenant ownership guard for accounts.
 *
 * `mode: "read"` refuses NotFound on mismatch (404) so we don't leak the
 * existence of another tenant's account on a GET. `mode: "act"` refuses
 * Forbidden on mismatch (403) for action verbs (PATCH/POST/DELETE) where
 * the caller has already named the resource and the API contract says we
 * explicitly deny rather than feign 404.
 */
export const accountOwnershipRefusal = (
	account: Pick<AccountItem, "accountId" | "accountConfigId">,
	callerAccountConfigId: string,
	mode: "read" | "act",
): Refusal | undefined => {
	if (account.accountConfigId === callerAccountConfigId) return undefined;
	if (mode === "read") {
		return {
			kind: "NotFound",
			message: `Account not found: ${account.accountId}`,
		};
	}
	return {
		kind: "Forbidden",
		message: `Account ${account.accountId} not in account config`,
	};
};

/**
 * Cross-account guard for a mailbox reached by id under an `accountId` path.
 * Ownership of the account only proves the caller owns the account in the path;
 * the `mailboxId` in that same path can belong to a different account, so without
 * this check a caller could read or mutate another account's mailbox. Mirrors the
 * read/act split of `accountOwnershipRefusal`: 404 on a read (no existence leak),
 * 403 on an action.
 */
export const mailboxInAccountRefusal = (
	mailbox: Pick<MailboxItem, "mailboxId" | "accountId">,
	accountId: string,
	mode: "read" | "act",
): Refusal | undefined => {
	if (mailbox.accountId === accountId) return undefined;
	if (mode === "read") {
		return {
			kind: "NotFound",
			message: `Mailbox not found: ${mailbox.mailboxId}`,
		};
	}
	return {
		kind: "Forbidden",
		message: `Mailbox ${mailbox.mailboxId} not in account`,
	};
};

/**
 * Why a folder cannot be bound to yet, per state — one wording in one place,
 * because the remedy differs and the client has only the sentence to show.
 */
const UNSETTLED_REASON: Record<string, (path: string) => string> = {
	[MailboxSyncStatus.pending]: (path) =>
		`“${path}” isn’t ready yet — the mail server hasn’t confirmed it.`,
	[MailboxSyncStatus.deleting]: (path) => `“${path}” is being deleted.`,
	[MailboxSyncStatus.failed]: (path) =>
		`The last change to “${path}” failed. Retry or dismiss it first.`,
};

/**
 * Every API write that binds a durable reference to a mailbox requires that
 * mailbox to be `synced` (D12, first row; imap-mutations R2: wait). A dangling
 * reference is permanent; blocking costs seconds.
 *
 * This is the server-side floor under the client-side wait, and it is not
 * redundant with it: there is more than one client, and a script hitting the
 * API directly gets no wait at all.
 *
 * It is the other half of D16. A binding is only ever created against a settled
 * folder (here) and only ever removed by the user (the delete refusal), so a
 * `mailboxId` that names nothing never exists — which is what lets every
 * reader of a filter's `actionMailboxId` or a role appointment treat the
 * reference as resolvable, with no missing-target branch.
 *
 * A `\Noselect` container is refused by construction — mailbox-sync keeps no
 * row for one — so there is nothing to bind to. Clearing a reference is not a
 * bind and is never gated, and neither is a move *out of* a folder: a
 * `deleting` folder still holds its mail until the DELETE lands, which is the
 * delete-with-move flow (D13).
 */
export const mailboxSettledRefusal = (
	target: Pick<MailboxItem, "mailboxId" | "fullPath" | "syncStatus">,
): Refusal | undefined => {
	const reason = UNSETTLED_REASON[target.syncStatus];
	if (!reason) return undefined;
	return {
		kind: "NotSettled",
		message: reason(target.fullPath),
		mailboxId: target.mailboxId,
		syncStatus: target.syncStatus,
	};
};
