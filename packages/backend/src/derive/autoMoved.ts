import type { AutoMovedInfo } from "@remit/api-openapi-types";
import type { MessageItem } from "@remit/data-ports";
import { PlacementConfidence } from "@remit/domain-enums";

/**
 * Project a Message's internal auto-move state to the public `AutoMovedInfo`
 * shape. Present only for a real, in-effect auto-move; absent otherwise, so a
 * message synced before either mechanism existed (no `filterMove`, no
 * `placementVerdict`) projects nothing and renders no badge.
 *
 * Two mechanisms move mail and both raise `movedByRemit`:
 *
 * 1. A standing filter (RFC 034) records a `filterMove` marker naming the
 *    source folder, the destination folder, and the filter. It has no
 *    classifier direction/role, so the projection carries mailbox ids
 *    (`fromMailboxId`/`destinationMailboxId`) and the `filterId` for the
 *    Settings link — an arbitrary destination the Inbox/Junk-shaped `action`
 *    cannot name.
 * 2. The Tier 0 classifier records a `placementVerdict`. Its `action`
 *    (MoveToInbox/MoveToJunk) and `fromPlacement` (inbox/junk/other) are the
 *    only fields that cross to the wire; confidence, dryRun, decidedAt and
 *    reasons stay internal.
 *
 * The filter marker outranks the verdict check: a matched filter's move is
 * exclusive and outranks the classifier's placement move at index time (RFC 034
 * Decision 3.1), so a message carrying both was ultimately moved by the filter.
 * The client derives everything else (whether the move is still in effect, the
 * undo target) from these fields plus current placement.
 */
export const deriveAutoMoved = (
	message: Pick<
		MessageItem,
		"movedByRemit" | "placementVerdict" | "filterMove"
	>,
): AutoMovedInfo | undefined => {
	if (message.movedByRemit !== true) return undefined;

	const filterMove = message.filterMove;
	if (filterMove) {
		return {
			fromMailboxId: filterMove.sourceMailboxId,
			destinationMailboxId: filterMove.destinationMailboxId,
			filterId: filterMove.filterId,
		};
	}

	const verdict = message.placementVerdict;
	if (!verdict) return undefined;
	if (verdict.confidence !== PlacementConfidence.Confident) return undefined;
	if (verdict.dryRun === true) return undefined;

	return {
		action: verdict.action,
		fromPlacement: verdict.fromPlacement,
	};
};
