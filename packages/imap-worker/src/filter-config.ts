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
import {
	EMBEDDING_PROVIDER_OFF,
	readEmbeddingProviderFromEnv,
} from "@remit/search-service/from-env";
import { getMessageEmbedder } from "./message-embedder.js";

export interface FilterConfigDeps {
	filterService: IFilterRepository;
	filterAnchorService: IFilterAnchorRepository;
	messageLabelService: IMessageLabelRepository;
	placementMoveService?: PlacementMoveService;
}

/**
 * The env-selected embedder, or none on an instance with semantic search off.
 *
 * `off` embeds nothing by design, and its embedder says so by throwing
 * (EmbeddingDisabledError). The pipeline has a designed skip for a *missing*
 * embedder — semantic filters are passed over and logged at debug — but a
 * present embedder that throws lands in the per-filter catch instead, which is
 * an error-level `filter_anchor_match_failed` for every semantic filter on
 * every synced message. Same outcome, a log nobody can read.
 */
const embedderFromEnv = (): MessageEmbedder | undefined =>
	readEmbeddingProviderFromEnv() === EMBEDDING_PROVIDER_OFF
		? undefined
		: getMessageEmbedder();

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
	const resolved = embedder ?? embedderFromEnv();
	return {
		filterService: deps.filterService,
		filterAnchorService: deps.filterAnchorService,
		messageLabelService: deps.messageLabelService,
		placementMoveService,
		...(resolved ? { embedder: resolved } : {}),
	};
};
