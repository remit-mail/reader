import type {
	DataType,
	FeatureExtractionPipeline,
	pipeline as PipelineFn,
} from "@huggingface/transformers";
import { runtimeImport } from "./backends/runtime-import.js";

export interface EmbeddingService {
	embed(texts: string[]): Promise<number[][]>;
	readonly dimensions: number;
	/**
	 * Stable identifier for the embedding model and the config that affects its
	 * output (model id + dimensions). Folded into each chunk's content hash so a
	 * model or dimension change invalidates the hash and forces a re-embed, while
	 * unchanged content under the same model stays a no-op.
	 */
	readonly embeddingId: string;
}

export interface DeterministicEmbeddingConfig {
	dimensions?: number;
}

const hashString = (s: string, seed: number): number => {
	let h = seed;
	for (let i = 0; i < s.length; i++) {
		h = (h * 31 + s.charCodeAt(i)) | 0;
	}
	return h;
};

const tokenize = (text: string): string[] => {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9@._\-+]+/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 0);
};

/**
 * Deterministic bag-of-words hashing embedder. Used in tests so the SearchService
 * can be exercised without calling Bedrock. Same input text always produces the
 * same vector, and overlapping tokens produce non-zero cosine similarity.
 */
export class DeterministicEmbeddingService implements EmbeddingService {
	readonly dimensions: number;
	readonly embeddingId: string;

	constructor(config: DeterministicEmbeddingConfig = {}) {
		this.dimensions = config.dimensions ?? 64;
		this.embeddingId = `deterministic@${this.dimensions}`;
	}

	embed = async (texts: string[]): Promise<number[][]> => {
		return texts.map((t) => this.embedOne(t));
	};

	private embedOne(text: string): number[] {
		const vector = new Array<number>(this.dimensions).fill(0);
		const tokens = tokenize(text);
		for (const token of tokens) {
			const idx = Math.abs(hashString(token, 0x9e3779b1)) % this.dimensions;
			const sign = hashString(token, 0x85ebca6b) & 1 ? 1 : -1;
			vector[idx] += sign;
		}
		let norm = 0;
		for (const v of vector) norm += v * v;
		if (norm === 0) return vector;
		const scale = 1 / Math.sqrt(norm);
		return vector.map((v) => v * scale);
	}
}

export const createDeterministicEmbeddingService = (
	config?: DeterministicEmbeddingConfig,
): EmbeddingService => new DeterministicEmbeddingService(config);

export interface LocalEmbeddingConfig {
	modelId?: string;
	dimensions?: number;
	/**
	 * ONNX weight precision Transformers.js loads. Left unset it defaults to
	 * `fp32` (the full-precision `model.onnx`); set to `q8` to load the
	 * int8-quantized `model_quantized.onnx`, which the search-index-worker
	 * container bakes to keep the image small. The bake step and this runtime
	 * must pass the same value so they resolve the identical cached file.
	 */
	dtype?: DataType;
}

const DEFAULT_LOCAL_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_LOCAL_DIMENSIONS = 384;

type TransformersModule = { pipeline: typeof PipelineFn };

/**
 * In-process CPU embedder backed by Transformers.js, used for local dev so the
 * SearchService produces real semantic vectors without calling Bedrock. The
 * model is downloaded once (cached on disk by `@huggingface/transformers`) and
 * loaded lazily on first use; the heavy dependency is never imported in the
 * production bundle (see runtime-import.ts).
 */
export class LocalEmbeddingService implements EmbeddingService {
	readonly dimensions: number;
	readonly embeddingId: string;
	private modelId: string;
	private dtype?: DataType;
	private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

	constructor(config: LocalEmbeddingConfig = {}) {
		this.modelId = config.modelId ?? DEFAULT_LOCAL_MODEL_ID;
		this.dimensions = config.dimensions ?? DEFAULT_LOCAL_DIMENSIONS;
		this.dtype = config.dtype;
		// dtype is part of the embedding identity: quantized weights produce
		// different vectors, and embeddingId feeds the content hash that gates
		// re-embedding. Unset keeps the historical id so existing fp32 indexes
		// are not invalidated.
		this.embeddingId = this.dtype
			? `local:${this.modelId}:${this.dtype}@${this.dimensions}`
			: `local:${this.modelId}@${this.dimensions}`;
	}

	private getPipeline = async (): Promise<FeatureExtractionPipeline> => {
		if (this.pipelinePromise) return this.pipelinePromise;
		this.pipelinePromise = (async () => {
			const { pipeline } = await runtimeImport<TransformersModule>(
				"@huggingface/transformers",
			);
			return pipeline("feature-extraction", this.modelId, {
				dtype: this.dtype,
			});
		})();
		return this.pipelinePromise;
	};

	embed = async (texts: string[]): Promise<number[][]> => {
		if (texts.length === 0) return [];
		const extractor = await this.getPipeline();
		const tensor = await extractor(texts, {
			pooling: "mean",
			normalize: true,
		});
		return tensor.tolist() as number[][];
	};
}

export const createLocalEmbeddingService = (
	config?: LocalEmbeddingConfig,
): EmbeddingService => new LocalEmbeddingService(config);
