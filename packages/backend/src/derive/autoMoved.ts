import type { MessageItem } from "@remit/data-ports";
import { PlacementConfidence } from "@remit/domain-enums";
import type { AutoMovedInfo } from "@remit/api-openapi-types";

/**
 * Project a Message's internal placement verdict to the public `AutoMovedInfo`
 * shape. Present only for a real, in-effect auto-move — `movedByRemit` is
 * true, the verdict is `Confident`, and it was not a dry run. Confidence,
 * dryRun, decidedAt and reasons are internal diagnostics and never cross to
 * the wire; the client derives everything else (whether the move is still in
 * effect, the undo target) from `action`/`fromPlacement` plus current
 * placement.
 */
export const deriveAutoMoved = (
	message: Pick<MessageItem, "movedByRemit" | "placementVerdict">,
): AutoMovedInfo | undefined => {
	if (message.movedByRemit !== true) return undefined;

	const verdict = message.placementVerdict;
	if (!verdict) return undefined;
	if (verdict.confidence !== PlacementConfidence.Confident) return undefined;
	if (verdict.dryRun === true) return undefined;

	return {
		action: verdict.action,
		fromPlacement: verdict.fromPlacement,
	};
};
