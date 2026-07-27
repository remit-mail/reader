import type { MessageEmbedder } from "@remit/mailbox-service";
import { buildEmbeddingServiceFromEnv } from "@remit/search-service/from-env";

/**
 * Adapt the batch {@link EmbeddingService} the rest of the stack composes from
 * env into the single-text {@link MessageEmbedder} the filter pipeline needs: one
 * incoming message becomes one message-level vector to compare against a filter's
 * persisted anchor (RFC 034 Decision 2.1/2.3).
 *
 * The embedder is selected by the same `SEARCH_EMBEDDING_*` env the backend and
 * search-index worker read, so the worker embeds under the identical model the
 * anchors were built with. The instance is memoized across warm invocations so a
 * local Transformers.js model loads once per container rather than per event.
 */
let cached: MessageEmbedder | undefined;

export const getMessageEmbedder = (): MessageEmbedder => {
	if (cached) return cached;
	const service = buildEmbeddingServiceFromEnv();
	cached = {
		embed: async (text: string): Promise<number[]> => {
			const [vector] = await service.embed([text]);
			return vector;
		},
		embeddingId: service.embeddingId,
	};
	return cached;
};

/** Reset the singleton — test use only. */
export const _resetMessageEmbedderForTest = (): void => {
	cached = undefined;
};
