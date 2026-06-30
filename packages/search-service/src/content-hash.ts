import { createHash } from "node:crypto";

/**
 * Stable hash of an embeddable chunk. Folds in the embedding model/version id so
 * the same text re-hashes differently after a model or dimension change, forcing
 * a re-embed; under the same model, unchanged text hashes identically and the
 * re-index skips the write.
 */
export const computeContentHash = (embeddingId: string, text: string): string =>
	createHash("sha256").update(`${embeddingId}\n${text}`).digest("hex");
