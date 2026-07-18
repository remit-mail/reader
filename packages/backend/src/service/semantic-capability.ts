import { logger } from "@remit/logger-lambda";
import { isSelfHostSqlBackend } from "../data-backend.js";

/**
 * Semantic-search capability gate for the self-host compose profiles.
 *
 * The backend container image ships neither `@huggingface/transformers` (query
 * embedding) nor `sqlite-vec` (the vector store's loadable extension, glibc-only
 * on top of that — see npm-scripts/docker-bundle.mjs and deploy/vps/README.md).
 * Both are reached lazily through `runtimeImport`, so the first semantic query —
 * not startup — hits ERR_MODULE_NOT_FOUND. Without this gate every search the
 * web client issues fires a `/search/semantic` request that 500s (the client
 * fetches semantic hits alongside every literal search), retried by the client
 * on top.
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
