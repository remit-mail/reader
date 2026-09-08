import { formatIndexProvenance } from "@remit/search-service";
import { buildEmbeddingServiceFromEnv } from "@remit/search-service/from-env";
import { readSqliteIndexProvenance } from "@remit/search-service/sqlite-vec";

/**
 * `remit check-index` (#455): which embedder wrote the vectors that are in the
 * index, counted against the one this deployment is configured with.
 *
 * An alternate entrypoint in the search-index-worker image — the same shape the
 * backend's `migrate.mjs` has — rather than an image or a service of its own. It
 * belongs in this image because this is where the configured embedder resolves:
 * the weight precision is part of the embedding identity and is set in this
 * image, so the same environment read from any other container names a model
 * that never wrote a vector here.
 *
 * Reads the vector store and writes nothing.
 */
const path = process.env.LOCAL_VECTORDB_PATH;
if (!path) {
	process.stderr.write(
		"LOCAL_VECTORDB_PATH is unset, so this deployment keeps no vector index on disk and there is nothing to report.\n",
	);
	process.exit(1);
}

const report = await readSqliteIndexProvenance({
	path,
	configuredEmbeddingId: buildEmbeddingServiceFromEnv().embeddingId,
});
process.stdout.write(formatIndexProvenance(report));
