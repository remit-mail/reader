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

/** A standing-filter move names an arbitrary destination via `destinationMailboxId`; a classifier move names a direction via `action`. */
const isFilterMove = (autoMoved: RemitImapAutoMovedInfo): boolean =>
	autoMoved.destinationMailboxId !== undefined;

/**
 * Plain-language badge text, e.g. "Moved from Junk by Remit". No jargon
 * (verdict/confidence/dryRun never surface) — mirrors the no-jargon precedent
 * in `rescue-candidates.ts`.
 *
 * A classifier move reads its source from the `fromPlacement` role. A
 * standing-filter move moved from an arbitrary folder, so the caller resolves
 * that folder's display name and passes it as `sourceFolderName`; absent (name
 * not resolved yet) falls back to "another folder".
 */
export const autoMovedLabel = (
	autoMoved: RemitImapAutoMovedInfo,
	sourceFolderName?: string,
): string => {
	if (isFilterMove(autoMoved)) {
		return `Moved from ${sourceFolderName ?? "another folder"} by Remit`;
	}
	const from = autoMoved.fromPlacement ?? "";
	return `Moved from ${FROM_PLACEMENT_LABEL[from] ?? "another folder"} by Remit`;
};

/**
 * The mailbox the verdict's `action` implies as the destination — where a
 * classifier-moved message should currently sit for the move to still be "in
 * effect".
 */
const impliedDestinationMailboxId = (
	action: string | undefined,
	mailboxes: AutoMovedRoleMailboxes,
): string | undefined => {
	if (action === PlacementAction.MoveToInbox) return mailboxes.inboxMailboxId;
	if (action === PlacementAction.MoveToJunk) return mailboxes.junkMailboxId;
	return undefined;
};

/**
 * True only while the auto-move is still in effect: the message currently sits
 * in the mailbox the move targeted. A standing-filter move targets the
 * `destinationMailboxId` it recorded; a classifier move targets the mailbox its
 * `action` implies. Once the message moves elsewhere (an undo, or any other
 * move), this returns false — the badge has no local "dismissed" flag; it
 * re-derives from current placement every render, per the data-flow rule that a
 * projection never forks from its source (doc/rules/data-flow.md).
 */
export const isAutoMoveInEffect = (
	autoMoved: RemitImapAutoMovedInfo | undefined,
	currentMailboxId: string | undefined,
	mailboxes: AutoMovedRoleMailboxes,
): boolean => {
	if (!autoMoved || !currentMailboxId) return false;
	const destination = isFilterMove(autoMoved)
		? autoMoved.destinationMailboxId
		: impliedDestinationMailboxId(autoMoved.action, mailboxes);
	return destination !== undefined && destination === currentMailboxId;
};

/**
 * Resolve the undo destination: where the message was before the move. A
 * standing-filter move recorded the exact source mailbox (`fromMailboxId`),
 * used verbatim. A classifier move recorded only a role (`fromPlacement`,
 * always `inbox` or `junk` for an actionable verdict — the Tier 0 classifier
 * only fires move-to-inbox from junk and move-to-junk from inbox, see
 * `classifyPlacement.ts`), resolved to the account's mailbox for that role.
 * `undefined` when the account has no mailbox for that role, or the source
 * cannot be resolved.
 */
export const resolveUndoTargetMailboxId = (
	autoMoved: RemitImapAutoMovedInfo | undefined,
	mailboxes: AutoMovedRoleMailboxes,
): string | undefined => {
	if (!autoMoved) return undefined;
	if (isFilterMove(autoMoved)) return autoMoved.fromMailboxId;
	if (autoMoved.fromPlacement === "inbox") return mailboxes.inboxMailboxId;
	if (autoMoved.fromPlacement === "junk") return mailboxes.junkMailboxId;
	return undefined;
};
