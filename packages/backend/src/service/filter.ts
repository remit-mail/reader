import {
	type AnchorPayload,
	buildEmbeddingServiceFromEnv,
	buildMessageAnchor,
	buildVectorStoreFromEnv,
} from "@remit/search-service";

/**
 * Build a filter's persisted semantic anchor from an already-indexed message's
 * chunk vectors (RFC 034 Decision 2.1), or `null` when the message has no
 * indexed chunks. Never embeds anything new — the vectors already exist from
 * index time.
 *
 * This is the only piece of filter CRUD not on the `RemitClient` port bundle:
 * the vector store and embedder are selected by env, independent of
 * `DATA_BACKEND`, so it works unchanged on either backend. The filter and
 * anchor rows themselves are written through
 * `client.filter`/`client.filterAnchor` so they land in the same backend as
 * everything else.
 */
export type BuildFilterAnchor = (
	accountConfigId: string,
	anchorMessageId: string,
) => Promise<AnchorPayload | null>;

let cached: BuildFilterAnchor | null = null;

const build = (): BuildFilterAnchor => {
	const embedder = buildEmbeddingServiceFromEnv();
	const store = buildVectorStoreFromEnv(embedder.dimensions);
	return (accountConfigId, anchorMessageId) =>
		buildMessageAnchor(
			{ store, embedder },
			{ accountConfigId, anchorMessageId },
		);
};

export const buildFilterAnchor: BuildFilterAnchor = (
	accountConfigId,
	anchorMessageId,
) => {
	if (!cached) cached = build();
	return cached(accountConfigId, anchorMessageId);
};

/** Inject the anchor builder — test use only. */
export const _setBuildFilterAnchorForTest = (
	override: BuildFilterAnchor,
): void => {
	cached = override;
};

/** Reset the singleton — test use only. */
export const _resetBuildFilterAnchorForTest = (): void => {
	cached = null;
};
