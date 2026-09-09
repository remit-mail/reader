import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { EmbeddingDisabledError } from "./embeddings.js";
import {
	buildEmbeddingServiceFromEnv,
	readEmbeddingProviderFromEnv,
} from "./from-env.js";

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

describe("SEARCH_EMBEDDING_PROVIDER=off", () => {
	it("builds an embedder that embeds nothing", () => {
		process.env.SEARCH_EMBEDDING_PROVIDER = "off";
		delete process.env.SEARCH_EMBEDDING_DIMENSIONS;

		const service = buildEmbeddingServiceFromEnv();

		assert.equal(service.embeddingId, "off@384");
	});

	it("keeps the store's column width, so turning it back on finds the vectors it left", () => {
		process.env.SEARCH_EMBEDDING_PROVIDER = "off";

		assert.equal(buildEmbeddingServiceFromEnv().dimensions, 384);
	});

	it("raises the capability absence the backend already degrades on, not empty results", async () => {
		process.env.SEARCH_EMBEDDING_PROVIDER = "off";
		const service = buildEmbeddingServiceFromEnv();

		await assert.rejects(
			() => service.embed(["anything"]),
			(error: unknown) => {
				assert.ok(error instanceof EmbeddingDisabledError);
				assert.equal(
					(error as { code: string }).code,
					"ERR_EMBEDDING_MODEL_UNAVAILABLE",
				);
				return true;
			},
		);
	});
});

describe("readEmbeddingProviderFromEnv", () => {
	it("accepts every provider this deployment understands", () => {
		for (const provider of ["off", "local", "bedrock", "deterministic"]) {
			process.env.SEARCH_EMBEDDING_PROVIDER = provider;
			assert.equal(readEmbeddingProviderFromEnv(), provider);
		}
	});

	it("falls back to the deterministic embedder when nothing is set", () => {
		delete process.env.SEARCH_EMBEDDING_PROVIDER;
		assert.equal(readEmbeddingProviderFromEnv(), "deterministic");

		process.env.SEARCH_EMBEDDING_PROVIDER = "";
		assert.equal(readEmbeddingProviderFromEnv(), "deterministic");
	});

	it("rejects a value nothing selects, rather than indexing with the test embedder", () => {
		for (const garbage of ["Off", "none", "disabled", "loca", "true"]) {
			process.env.SEARCH_EMBEDDING_PROVIDER = garbage;
			assert.throws(
				() => readEmbeddingProviderFromEnv(),
				/SEARCH_EMBEDDING_PROVIDER must be one of/,
				garbage,
			);
			assert.throws(
				() => buildEmbeddingServiceFromEnv(),
				/SEARCH_EMBEDDING_PROVIDER must be one of/,
				garbage,
			);
		}
	});
});
