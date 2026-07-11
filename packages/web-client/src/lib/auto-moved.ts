import type { RemitImapAutoMovedInfo } from "@remit/api-http-client/types.gen.ts";
import { PlacementAction } from "@remit/domain-enums";

/** The two folder roles the account's mailboxes can resolve for this feature. */
export interface AutoMovedRoleMailboxes {
	inboxMailboxId: string | undefined;
	junkMailboxId: string | undefined;
}

const FROM_PLACEMENT_LABEL: Record<string, string> = {
	inbox: "Inbox",
	junk: "Junk",
};

/**
 * Plain-language badge text, e.g. "Moved from Junk by Remit". No jargon
 * (verdict/confidence/dryRun never surface) — mirrors the no-jargon precedent
 * in `rescue-candidates.ts`.
 */
export const autoMovedLabel = (fromPlacement: string): string =>
	`Moved from ${FROM_PLACEMENT_LABEL[fromPlacement] ?? "another folder"} by Remit`;

/**
 * The mailbox the verdict's `action` implies as the destination — where the
 * message should currently sit for the move to still be "in effect".
 */
const impliedDestinationMailboxId = (
	action: string,
	mailboxes: AutoMovedRoleMailboxes,
): string | undefined => {
	if (action === PlacementAction.MoveToInbox) return mailboxes.inboxMailboxId;
	if (action === PlacementAction.MoveToJunk) return mailboxes.junkMailboxId;
	return undefined;
};

/**
 * True only while the auto-move is still in effect: the message currently
 * sits in the mailbox the verdict's `action` implied. Once the message moves
 * elsewhere (an undo, or any other move), this returns false — the badge has
 * no local "dismissed" flag; it re-derives from current placement every
 * render, per the data-flow rule that a projection never forks from its
 * source (doc/rules/data-flow.md).
 */
export const isAutoMoveInEffect = (
	autoMoved: RemitImapAutoMovedInfo | undefined,
	currentMailboxId: string | undefined,
	mailboxes: AutoMovedRoleMailboxes,
): boolean => {
	if (!autoMoved || !currentMailboxId) return false;
	const destination = impliedDestinationMailboxId(autoMoved.action, mailboxes);
	return destination !== undefined && destination === currentMailboxId;
};

/**
 * Resolve the undo destination: the mailbox filling the role the message was
 * moved from. `fromPlacement` is always `inbox` or `junk` for an actionable
 * verdict (the Tier 0 classifier only fires move-to-inbox from junk and
 * move-to-junk from inbox — see `classifyPlacement.ts`); `undefined` when the
 * account has no mailbox appointed to that role.
 */
export const resolveUndoTargetMailboxId = (
	fromPlacement: string,
	mailboxes: AutoMovedRoleMailboxes,
): string | undefined => {
	if (fromPlacement === "inbox") return mailboxes.inboxMailboxId;
	if (fromPlacement === "junk") return mailboxes.junkMailboxId;
	return undefined;
};
