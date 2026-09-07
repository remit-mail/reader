/**
 * Whether this process can embed at all, remembered per process.
 *
 * The backend and imap-worker container images ship without
 * `@huggingface/transformers` (npm-scripts/docker-bundle.mjs,
 * docker/runtime/backend/package.json), and the `off` provider embeds nothing by
 * design. Both reach a caller as a throw carrying one of the codes below — a
 * module that will not resolve, a native extension that will not load, or the
 * typed {@link EmbeddingModelUnavailableError} / {@link EmbeddingDisabledError}.
 *
 * Every consumer that must degrade rather than crash classifies through here, so
 * the vocabulary of "this deployment carries no embedding pipeline" is written
 * once: the backend's `/search/semantic` gate
 * (packages/backend/src/service/semantic-capability.ts, which adds the self-host
 * scoping) and the filter pipeline's semantic skip
 * (packages/mailbox-service/src/filters/pipeline.ts) both read the same flag, so
 * one failed embed anywhere in the process is the whole probe.
 */
const CAPABILITY_ABSENCE_CODES = new Set([
	"ERR_MODULE_NOT_FOUND",
	"MODULE_NOT_FOUND",
	"ERR_DLOPEN_FAILED",
	"ERR_EMBEDDING_MODEL_UNAVAILABLE",
]);

let unavailable = false;

/** Whether a failure is the shape of an absent embedding pipeline. */
export const isEmbeddingCapabilityAbsence = (error: unknown): boolean => {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" && CAPABILITY_ABSENCE_CODES.has(code);
};

/** Whether an absence has already been observed in this process. */
export const isEmbeddingCapabilityUnavailable = (): boolean => unavailable;

/**
 * Remember an observed absence, so later callers short-circuit instead of
 * failing again. Returns false and records nothing for any other error, which is
 * the caller's to rethrow.
 */
export const recordEmbeddingCapabilityAbsence = (error: unknown): boolean => {
	if (!isEmbeddingCapabilityAbsence(error)) return false;
	unavailable = true;
	return true;
};

/** Test-only reset for the memoized absence. */
export const _resetEmbeddingCapabilityForTest = (): void => {
	unavailable = false;
};
