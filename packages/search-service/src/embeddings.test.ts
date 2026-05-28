import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { mockClient } from "aws-sdk-client-mock";
import { BedrockEmbeddingService } from "./embeddings.js";

const encodeTitanResponse = (dimensions: number): Uint8Array =>
	new TextEncoder().encode(
		JSON.stringify({ embedding: new Array(dimensions).fill(0) }),
	);

describe("BedrockEmbeddingService", () => {
	it("caps in-flight InvokeModel calls to the configured concurrency", async () => {
		const concurrency = 6;
		const total = 20;
		let inFlight = 0;
		let peak = 0;

		const bedrockMock = mockClient(BedrockRuntimeClient);
		bedrockMock.on(InvokeModelCommand).callsFake(async () => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 10));
			inFlight -= 1;
			return { body: encodeTitanResponse(1024) };
		});

		const service = new BedrockEmbeddingService({
			client: new BedrockRuntimeClient({}),
			concurrency,
		});

		const texts = Array.from({ length: total }, (_, i) => `text-${i}`);
		const results = await service.embed(texts);

		assert.equal(results.length, total);
		assert.ok(
			peak <= concurrency,
			`peak in-flight ${peak} exceeded concurrency ${concurrency}`,
		);
		assert.equal(bedrockMock.commandCalls(InvokeModelCommand).length, total);
	});

	it("returns embeddings in the same order as the input texts", async () => {
		const bedrockMock = mockClient(BedrockRuntimeClient);
		bedrockMock.on(InvokeModelCommand).callsFake(async (input) => {
			const body = JSON.parse(input.body as string) as { inputText: string };
			const tag = Number.parseInt(body.inputText.split("-")[1] ?? "0", 10);
			await new Promise((resolve) => setTimeout(resolve, (5 - (tag % 5)) * 2));
			return {
				body: new TextEncoder().encode(
					JSON.stringify({ embedding: [tag, 0, 0, 0] }),
				),
			};
		});

		const service = new BedrockEmbeddingService({
			client: new BedrockRuntimeClient({}),
			dimensions: 4,
			concurrency: 3,
		});

		const texts = ["text-0", "text-1", "text-2", "text-3", "text-4"];
		const results = await service.embed(texts);

		assert.deepEqual(
			results.map((v) => v[0]),
			[0, 1, 2, 3, 4],
		);
	});
});
