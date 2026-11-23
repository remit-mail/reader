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
	labelMailboxService: FilterConfig["labelMailboxService"];
	placementMoveService: PlacementMoveService;
}

/**
 * Assemble the filter config a body-materializing pass runs (RFC 034), shared by
 * the imap-worker's sync path and the backend's read-path backfill.
 */
export const buildFilterConfig = (deps: FilterConfigDeps): FilterConfig => ({
	filterService: deps.filterService,
	messageLabelService: deps.messageLabelService,
	mailboxService: deps.mailboxService,
	labelMailboxService: deps.labelMailboxService,
	placementMoveService: deps.placementMoveService,
});
