import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalEmbeddingService } from "./embeddings.js";

describe("LocalEmbeddingService", () => {
	it("keeps the historical embeddingId when dtype is unset", () => {
		const service = new LocalEmbeddingService({
			modelId: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
			dimensions: 384,
		});
		assert.equal(
			service.embeddingId,
			"local:Xenova/paraphrase-multilingual-MiniLM-L12-v2@384",
		);
	});

	it("includes dtype in the embeddingId so quantized vectors get their own content hashes", () => {
		const service = new LocalEmbeddingService({
			modelId: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
			dimensions: 384,
			dtype: "q8",
		});
		assert.equal(
			service.embeddingId,
			"local:Xenova/paraphrase-multilingual-MiniLM-L12-v2:q8@384",
		);
	});
});
