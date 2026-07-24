import { logger } from "@remit/logger-lambda";
import { isSelfHostSqlBackend } from "../data-backend.js";

/**
 * Semantic-search capability gate for the self-host compose profiles.
 *
 * This gates the free-text `/search/semantic` path only. Answering that query
 * means embedding it in-process, and the backend container image ships without
 * `@huggingface/transformers` (the model plus its dependencies would roughly
 * quadruple the image — see npm-scripts/docker-bundle.mjs and
 * deploy/vps/README.md). The embedder is reached lazily through `runtimeImport`,
 * so the first semantic query — not startup — hits ERR_MODULE_NOT_FOUND. Without
 * this gate every search the web client issues fires a `/search/semantic`
 * request that 500s (the client fetches semantic hits alongside every literal
 * search), retried by the client on top.
 *
 * The vector STORE is a separate capability and is NOT gated here. The Organize
 * anchor widen (organize.ts matchSemantic) pools an anchor message's already
 * stored chunk vectors and runs a KNN read over the vector store — no embedding
 * model involved — so it needs only `sqlite-vec`, which the backend image now
 * carries as a musl build (Dockerfile sqlite-vec-musl stage,
 * SQLITE_VEC_EXTENSION_PATH). matchOrganize never consults the memoized flag
 * below; a missing embedder therefore never disables the widen.
 *
 * The e2e-dev lane runs this backend from source rather than the container, so
 * `@huggingface/transformers` IS present and the local embedder instead tries to
 * lazily download the model from HuggingFace; a transient `fetch failed` there
 * surfaces the same way. The search-service raises it as a typed
 * `EmbeddingModelUnavailableError` (code ERR_EMBEDDING_MODEL_UNAVAILABLE), which
 * this gate treats as the same capability absence — the model is not available,
 * empty semantic results are the truthful answer, and the lane never depends on
 * a live external download.
 *
 * When the pipeline is genuinely absent, empty hits are the truthful answer:
 * the FTS/literal engine is the primary search surface on these profiles and is
 * unaffected. The absence is remembered so subsequent requests short-circuit.
 *
 * Scoped to the self-host SQL backends: on AWS the pipeline (Bedrock +
 * S3 Vectors) is bundled, so a module-resolution failure there is a broken
 * deploy and must keep failing loud. Falling back to the FTS engine here
 * instead was considered and rejected — it would fabricate relevance scores and
 * matched-chunk labels for the "Related" UI, and cannot serve the cross-account
 * queries the daily brief issues.
 */

const CAPABILITY_ABSENCE_CODES = new Set([
	"ERR_MODULE_NOT_FOUND",
	"MODULE_NOT_FOUND",
	"ERR_DLOPEN_FAILED",
	"ERR_EMBEDDING_MODEL_UNAVAILABLE",
]);

let semanticUnavailable = false;

/** Test-only reset for the memoized absence. */
export const _resetSemanticCapabilityForTest = (): void => {
	semanticUnavailable = false;
};

export const isSemanticSearchUnavailable = (): boolean => semanticUnavailable;

/**
 * Classify a semantic-search failure. Returns true — and remembers the
 * absence — when it is the missing-module/extension shape on a self-host SQL
 * backend; any other error is the caller's to rethrow.
 */
export const noteSemanticCapabilityAbsence = (error: unknown): boolean => {
	if (!isSelfHostSqlBackend()) return false;
	const code = (error as { code?: unknown } | null)?.code;
	if (typeof code !== "string" || !CAPABILITY_ABSENCE_CODES.has(code)) {
		return false;
	}
	if (!semanticUnavailable) {
		logger.warn(
			{ error: error instanceof Error ? error.message : String(error) },
			"Semantic search pipeline unavailable in this deployment — serving empty semantic results (see deploy/vps/README.md)",
		);
	}
	semanticUnavailable = true;
	return true;
};
