import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import pLimit from "p-limit";

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

export interface BedrockEmbeddingConfig {
	client?: BedrockRuntimeClient;
	region?: string;
	modelId?: string;
	dimensions?: number;
	concurrency?: number;
}

const DEFAULT_MODEL_ID = "amazon.titan-embed-text-v2:0";
const DEFAULT_DIMENSIONS = 1024;
const DEFAULT_CONCURRENCY = 6;

/**
 * Titan v2 rejects inputs over its 8192-token limit. Chunk builders already cap
 * their output, but this is a final backstop so no chunk source can ever push
 * an over-budget inputText to Bedrock. 6000 chars is safe for typical Latin text
 * (~4 chars/token), but dense or non-Latin scripts (CJK, packed entity lists)
 * can exceed 8192 tokens at far fewer chars — observed up to ~21k tokens from a
 * 6000-char chunk. On a token-limit rejection we halve and retry rather than let
 * a valid-but-dense message dead-letter forever (#910).
 */
const MAX_INPUT_CHARS = 6000;
// Below this we stop shrinking and let the error surface: a chunk this small
// that still overflows is not something a retry can fix.
const MIN_INPUT_CHARS = 256;

const isTokenLimitError = (error: unknown): boolean =>
	error instanceof Error &&
	/too many input tokens|input is too long|maximum.*token/i.test(error.message);

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
	readonly embeddingId: string;
	private limit: ReturnType<typeof pLimit>;

	constructor(config: BedrockEmbeddingConfig = {}) {
		this.client =
			config.client ?? new BedrockRuntimeClient({ region: config.region });
		this.modelId = config.modelId ?? DEFAULT_MODEL_ID;
		this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
		this.embeddingId = `${this.modelId}@${this.dimensions}`;
		this.limit = pLimit(config.concurrency ?? DEFAULT_CONCURRENCY);
	}

	embed = async (texts: string[]): Promise<number[][]> =>
		Promise.all(texts.map((text) => this.limit(() => this.embedOne(text))));

	private embedOne = async (text: string): Promise<number[]> => {
		let charBudget = MAX_INPUT_CHARS;
		while (true) {
			try {
				return await this.invoke(text.slice(0, charBudget));
			} catch (error) {
				if (!isTokenLimitError(error) || charBudget <= MIN_INPUT_CHARS) {
					throw error;
				}
				charBudget = Math.max(MIN_INPUT_CHARS, Math.floor(charBudget / 2));
			}
		}
	};

	private invoke = async (inputText: string): Promise<number[]> => {
		const cmd = new InvokeModelCommand({
			modelId: this.modelId,
			contentType: "application/json",
			accept: "application/json",
			body: JSON.stringify({
				inputText,
				dimensions: this.dimensions,
				normalize: true,
			}),
		});
		const response = await this.client.send(cmd);
		if (!response.body) {
			throw new Error("Bedrock InvokeModel returned empty body");
		}
		return parseTitanResponse(response.body);
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
