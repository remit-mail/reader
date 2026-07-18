import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { mockClient } from "aws-sdk-client-mock";
import { BedrockEmbeddingService } from "./bedrock.js";

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

	it("truncates over-budget input before sending it to Bedrock", async () => {
		const bedrockMock = mockClient(BedrockRuntimeClient);
		let sentLength = 0;
		bedrockMock.on(InvokeModelCommand).callsFake((input) => {
			const body = JSON.parse(input.body as string) as { inputText: string };
			sentLength = body.inputText.length;
			return { body: encodeTitanResponse(1024) };
		});

		const service = new BedrockEmbeddingService({
			client: new BedrockRuntimeClient({}),
		});

		await service.embed(["x".repeat(50000)]);

		assert.ok(
			sentLength <= 6000,
			`inputText length ${sentLength} exceeds the 6000-char budget`,
		);
	});

	it("shrinks and retries when Bedrock rejects a dense input as over-budget", async () => {
		// A 6000-char chunk of dense/non-Latin text can still exceed Titan's
		// 8192-token limit even though it's within the char budget. Rather than
		// dead-letter the message forever, the embedder halves the input and
		// retries until Bedrock accepts it (#910).
		const bedrockMock = mockClient(BedrockRuntimeClient);
		const sentLengths: number[] = [];
		bedrockMock.on(InvokeModelCommand).callsFake((input) => {
			const body = JSON.parse(input.body as string) as { inputText: string };
			sentLengths.push(body.inputText.length);
			if (body.inputText.length > 3000) {
				throw new Error(
					"ValidationException: 400 Bad Request: Too many input tokens. Max input tokens: 8192, request input token count: 14022",
				);
			}
			return { body: encodeTitanResponse(1024) };
		});

		const service = new BedrockEmbeddingService({
			client: new BedrockRuntimeClient({}),
		});

		const [vector] = await service.embed(["字".repeat(50000)]);

		assert.equal(vector.length, 1024);
		assert.equal(sentLengths[0], 6000, "first attempt uses the full budget");
		assert.ok(
			// biome-ignore lint/style/noNonNullAssertion: test assertion, value is guaranteed by test setup
			sentLengths.at(-1) !== undefined && sentLengths.at(-1)! <= 3000,
			"a later attempt shrinks under the token limit",
		);
	});

	it("surfaces a non-token error without shrinking and retrying", async () => {
		const bedrockMock = mockClient(BedrockRuntimeClient);
		let calls = 0;
		bedrockMock.on(InvokeModelCommand).callsFake(() => {
			calls += 1;
			throw new Error("AccessDeniedException: not authorized");
		});

		const service = new BedrockEmbeddingService({
			client: new BedrockRuntimeClient({}),
		});

		await assert.rejects(
			service.embed(["hello"]),
			/AccessDeniedException/,
			"non-token errors must propagate",
		);
		assert.equal(calls, 1, "no shrink-retry for non-token errors");
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
