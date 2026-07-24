import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { pipeline as PipelineFn } from "@huggingface/transformers";
import {
	EmbeddingModelUnavailableError,
	LocalEmbeddingService,
} from "./embeddings.js";

// Exercises the model-load path without the network: the pipeline factory
// rejects the way a failed `from_pretrained` (HuggingFace fetch failed) does.
class FailingLoadService extends LocalEmbeddingService {
	importCount = 0;
	protected importTransformers(): Promise<{ pipeline: typeof PipelineFn }> {
		this.importCount++;
		const pipeline = (() =>
			Promise.reject(
				new TypeError("fetch failed"),
			)) as unknown as typeof PipelineFn;
		return Promise.resolve({ pipeline });
	}
}

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

	it("raises a typed EmbeddingModelUnavailableError when the model cannot be loaded", async () => {
		const service = new FailingLoadService({ dimensions: 8 });
		await assert.rejects(
			() => service.embed(["hello"]),
			(error: unknown) => {
				assert.ok(error instanceof EmbeddingModelUnavailableError);
				assert.equal(
					(error as { code?: string }).code,
					"ERR_EMBEDDING_MODEL_UNAVAILABLE",
				);
				return true;
			},
		);
	});

	it("clears the memoized pipeline on a load failure so a later call retries", async () => {
		const service = new FailingLoadService({ dimensions: 8 });
		await assert.rejects(() => service.embed(["hello"]));
		await assert.rejects(() => service.embed(["hello"]));
		assert.equal(service.importCount, 2);
	});
});
