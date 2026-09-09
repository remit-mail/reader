import type { EmbedAnchor } from "@remit/config-transfer";
import { logger } from "@remit/logger-lambda";
import { buildEmbeddingServiceFromEnv } from "@remit/search-service/from-env";
import { isSemanticCapabilityAbsence } from "./semantic-capability.js";

type Embedder = {
	embed: (texts: string[]) => Promise<number[][]>;
	readonly embeddingId: string;
};

let cached: Embedder | null = null;

/**
 * Re-embed a filter's anchor from the source text its file carries. The vector
 * never travels — it is a function of the model that produced it — so this is
 * the one thing an import computes rather than copies.
 *
 * A deployment that ships no vector pipeline answers `undefined` rather than
 * failing the import: the anchor then lands stamped as un-embedded, and the
 * same lazy repair that handles a model migration builds its vector the first
 * time the filter is matched. A configuration file has to be importable on the
 * instance a person is recovering onto, whatever that instance can run.
 */
export const embedAnchorText: EmbedAnchor = async (sourceText) => {
	try {
		if (!cached) cached = buildEmbeddingServiceFromEnv();
		const [embedding] = await cached.embed([sourceText]);
		return embedding
			? { embedding, embeddingId: cached.embeddingId }
			: undefined;
	} catch (error) {
		if (!isSemanticCapabilityAbsence(error)) throw error;
		logger.warn(
			{ error: error instanceof Error ? error.message : String(error) },
			"No embedding pipeline in this deployment; an imported filter anchor is stored as text and embedded on first use",
		);
		return undefined;
	}
};
