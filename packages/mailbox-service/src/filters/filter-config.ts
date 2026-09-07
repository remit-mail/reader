import type {
	IFilterAnchorRepository,
	IFilterRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";
import { isEmbeddingCapabilityUnavailable } from "@remit/search-service/capability";
import {
	EMBEDDING_PROVIDER_OFF,
	readEmbeddingProviderFromEnv,
} from "@remit/search-service/from-env";
import type { PlacementMoveService } from "../placement-move.js";
import { getMessageEmbedder } from "./message-embedder.js";
import type { FilterConfig, MessageEmbedder } from "./pipeline.js";

export interface FilterConfigDeps {
	filterService: IFilterRepository;
	filterAnchorService: IFilterAnchorRepository;
	messageLabelService: IMessageLabelRepository;
	placementMoveService?: PlacementMoveService;
}

/**
 * The env-selected embedder, or none on an instance that cannot embed.
 *
 * `off` embeds nothing by design, and its embedder says so by throwing
 * (EmbeddingDisabledError). The pipeline has a designed skip for a *missing*
 * embedder — semantic filters are passed over and logged at debug — but a
 * present embedder that throws lands in the per-filter catch instead, which is
 * an error-level `filter_anchor_match_failed` for every semantic filter on
 * every synced message. Same outcome, a log nobody can read.
 *
 * `local` on the self-host profiles reaches the same place by a different road:
 * the backend and imap-worker images ship without `@huggingface/transformers`,
 * so the first embed throws ERR_MODULE_NOT_FOUND. The pipeline classifies that
 * one throw through `@remit/search-service/capability` and remembers it, and
 * from then on the config here wires no embedder either — one probe per process,
 * not one per filter per message.
 */
const embedderFromEnv = (): MessageEmbedder | undefined =>
	readEmbeddingProviderFromEnv() === EMBEDDING_PROVIDER_OFF ||
	isEmbeddingCapabilityUnavailable()
		? undefined
		: getMessageEmbedder();

/**
 * Assemble the filter config a body-materializing pass runs (RFC 034), shared by
 * the imap-worker's sync path and the backend's read-path backfill so both embed
 * under the same model that produced the anchors — a semantic (anchor-only)
 * filter is evaluated on either path instead of silently skipped.
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
