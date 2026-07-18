import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { buildEmbeddingServiceFromEnv } from "./from-env.js";

const ENV_KEYS = [
	"SEARCH_EMBEDDING_PROVIDER",
	"SEARCH_EMBEDDING_MODEL_ID",
	"SEARCH_EMBEDDING_DIMENSIONS",
	"SEARCH_EMBEDDING_DTYPE",
] as const;

const saved = new Map<string, string | undefined>(
	ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
	for (const [key, value] of saved) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("buildEmbeddingServiceFromEnv dtype handling", () => {
	it("builds a local embedder without dtype in its id when SEARCH_EMBEDDING_DTYPE is unset", () => {
		process.env.SEARCH_EMBEDDING_PROVIDER = "local";
		process.env.SEARCH_EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
		delete process.env.SEARCH_EMBEDDING_DTYPE;

		const service = buildEmbeddingServiceFromEnv();

		assert.equal(service.embeddingId, "local:Xenova/all-MiniLM-L6-v2@384");
	});

	it("threads SEARCH_EMBEDDING_DTYPE into the local embedder identity", () => {
		process.env.SEARCH_EMBEDDING_PROVIDER = "local";
		process.env.SEARCH_EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
		process.env.SEARCH_EMBEDDING_DTYPE = "q8";

		const service = buildEmbeddingServiceFromEnv();

		assert.equal(service.embeddingId, "local:Xenova/all-MiniLM-L6-v2:q8@384");
	});

	it("rejects an unknown SEARCH_EMBEDDING_DTYPE loudly", () => {
		process.env.SEARCH_EMBEDDING_PROVIDER = "local";
		process.env.SEARCH_EMBEDDING_DTYPE = "int7";

		assert.throws(
			() => buildEmbeddingServiceFromEnv(),
			/SEARCH_EMBEDDING_DTYPE must be one of/,
		);
	});

	it("ignores SEARCH_EMBEDDING_DTYPE for non-local providers", () => {
		delete process.env.SEARCH_EMBEDDING_PROVIDER;
		process.env.SEARCH_EMBEDDING_DTYPE = "not-a-dtype";

		const service = buildEmbeddingServiceFromEnv();

		assert.equal(service.embeddingId, "deterministic@64");
	});
});
