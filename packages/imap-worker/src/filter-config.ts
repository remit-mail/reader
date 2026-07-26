import type {
	IFilterAnchorRepository,
	IFilterRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";
import type {
	FilterConfig,
	MessageEmbedder,
	PlacementMoveService,
} from "@remit/mailbox-service";
import { getMessageEmbedder } from "./message-embedder.js";

export interface FilterConfigDeps {
	filterService: IFilterRepository;
	filterAnchorService: IFilterAnchorRepository;
	messageLabelService: IMessageLabelRepository;
	placementMoveService?: PlacementMoveService;
}

/**
 * Assemble the index-time filter config the body-sync pass runs (RFC 034). The
 * embedder is provisioned from env exactly as the backend read-path and
 * search-index worker provision theirs, so a semantic (anchor-only) filter is
 * evaluated on incoming mail instead of silently skipped.
 *
 * Absent the placement mover there is no move path, so filters stay off — a
 * matched filter's actions reuse the same enqueue plumbing the placement mover
 * owns.
 */
export const buildFilterConfig = (
	deps: FilterConfigDeps,
	embedder?: MessageEmbedder,
): FilterConfig | undefined => {
	const { placementMoveService } = deps;
	if (!placementMoveService) return undefined;
	return {
		filterService: deps.filterService,
		filterAnchorService: deps.filterAnchorService,
		messageLabelService: deps.messageLabelService,
		placementMoveService,
		embedder: embedder ?? getMessageEmbedder(),
	};
};
