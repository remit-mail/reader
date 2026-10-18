import type {
	IFilterRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";
import type { PlacementMoveService } from "../placement-move.js";
import type { FilterConfig } from "./pipeline.js";

export interface FilterConfigDeps {
	filterService: IFilterRepository;
	messageLabelService: IMessageLabelRepository;
	mailboxService: FilterConfig["mailboxService"];
	placementMoveService?: PlacementMoveService;
}

/**
 * Assemble the filter config a body-materializing pass runs (RFC 034), shared by
 * the imap-worker's sync path and the backend's read-path backfill.
 *
 * Absent the placement mover there is no move path, so filters stay off — a
 * matched filter's actions reuse the same enqueue plumbing the placement mover
 * owns.
 */
export const buildFilterConfig = (
	deps: FilterConfigDeps,
): FilterConfig | undefined => {
	const { placementMoveService } = deps;
	if (!placementMoveService) return undefined;
	return {
		filterService: deps.filterService,
		messageLabelService: deps.messageLabelService,
		mailboxService: deps.mailboxService,
		placementMoveService,
	};
};
