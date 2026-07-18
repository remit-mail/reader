import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import pLimit from "p-limit";
import type { EmbeddingService } from "../embeddings.js";

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
