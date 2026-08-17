import type {
	FilterAnchorItem,
	IFilterAnchorRepository,
} from "@remit/data-ports";

/**
 * The half of an embedding service an anchor refresh needs: the text-to-vector
 * call and the `<modelId>@<dimensions>` identifier of the model behind it (the
 * same scheme `EmbeddingService.embeddingId` derives). Compared against
 * `FilterAnchor.anchorEmbeddingId` to detect a model drift a same-dimension
 * swap would otherwise pass through silently (RFC 039 Decision 1a, reader
 * #295).
 */
export interface AnchorEmbedder {
	embed(text: string): Promise<number[]>;
	readonly embeddingId: string;
}

export interface AnchorDriftDeps {
	anchorRepository: Pick<IFilterAnchorRepository, "put">;
	/** Absent on a deployment with no embedder wired; then nothing can drift. */
	embedder: AnchorEmbedder | undefined;
}

/**
 * The anchor to score against, re-embedded in place when the embedding model
 * has drifted since it was written (RFC 039 Decision 1a). No migration job
 * walks these rows proactively, so the refresh is lazy: the first read that
 * notices the stamp no longer matches the configured model re-embeds the
 * already-persisted `anchorSourceText` and writes it back under the current
 * id. A failure here is never a terminal state — the row is left as it was,
 * so the next read that reaches this anchor retries.
 *
 * The single mechanism behind both index-time matching
 * ({@link FilterPipeline}) and the back-apply pass's cross-filter precedence
 * check, which must agree on what a filter currently matches (reader #399).
 */
export const refreshAnchorForEmbedder = async (
	deps: AnchorDriftDeps,
	anchor: FilterAnchorItem,
): Promise<FilterAnchorItem> => {
	const { embedder } = deps;
	if (!embedder || anchor.anchorEmbeddingId === embedder.embeddingId) {
		return anchor;
	}
	const anchorEmbedding = await embedder.embed(anchor.anchorSourceText);
	return deps.anchorRepository.put({
		accountConfigId: anchor.accountConfigId,
		filterId: anchor.filterId,
		anchorEmbedding,
		anchorEmbeddingId: embedder.embeddingId,
		anchorSourceText: anchor.anchorSourceText,
		anchorMessageId: anchor.anchorMessageId,
	});
};
