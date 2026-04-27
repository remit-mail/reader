import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

export interface EmbeddingService {
	embed(texts: string[]): Promise<number[][]>;
	readonly dimensions: number;
}

export interface BedrockEmbeddingConfig {
	client?: BedrockRuntimeClient;
	region?: string;
	modelId?: string;
	dimensions?: number;
}

const DEFAULT_MODEL_ID = "amazon.titan-embed-text-v2:0";
const DEFAULT_DIMENSIONS = 1024;

const isNumberArray = (value: unknown): value is number[] =>
	Array.isArray(value) && value.every((n) => typeof n === "number");

const parseTitanResponse = (raw: Uint8Array): number[] => {
	const text = new TextDecoder().decode(raw);
	const parsed: unknown = JSON.parse(text);
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		"embedding" in parsed &&
		isNumberArray((parsed as { embedding: unknown }).embedding)
	) {
		return (parsed as { embedding: number[] }).embedding;
	}
	throw new Error("Bedrock Titan response missing 'embedding' array");
};

export class BedrockEmbeddingService implements EmbeddingService {
	private client: BedrockRuntimeClient;
	private modelId: string;
	readonly dimensions: number;

	constructor(config: BedrockEmbeddingConfig = {}) {
		this.client =
			config.client ?? new BedrockRuntimeClient({ region: config.region });
		this.modelId = config.modelId ?? DEFAULT_MODEL_ID;
		this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
	}

	embed = async (texts: string[]): Promise<number[][]> => {
		const results: number[][] = [];
		for (const text of texts) {
			const cmd = new InvokeModelCommand({
				modelId: this.modelId,
				contentType: "application/json",
				accept: "application/json",
				body: JSON.stringify({
					inputText: text,
					dimensions: this.dimensions,
					normalize: true,
				}),
			});
			const response = await this.client.send(cmd);
			if (!response.body) {
				throw new Error("Bedrock InvokeModel returned empty body");
			}
			results.push(parseTitanResponse(response.body));
		}
		return results;
	};
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

	constructor(config: DeterministicEmbeddingConfig = {}) {
		this.dimensions = config.dimensions ?? 64;
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
