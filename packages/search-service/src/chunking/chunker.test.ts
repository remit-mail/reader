import assert from "node:assert";
import { describe, it } from "node:test";
import type {
	ChunkType,
	EnvelopeChunkInput,
	ParsedBodyForChunking,
} from "../types.js";
import { createEmailChunker } from "./chunker.js";
import { candidateChunkKeys } from "./keys.js";

const MESSAGE_ID = "msg-parity-1";

const envelope: EnvelopeChunkInput = {
	from: { name: "Alice", email: "alice@example.com" },
	to: [{ name: "Bob", email: "bob@example.com" }],
	cc: [{ name: "Carol", email: "carol@example.com" }],
	bcc: [],
	subject: "Q1 2026 invoice review and operational metrics",
	attachments: [
		{
			filename: "invoice-q1-2026.pdf",
			contentType: "application/pdf",
			size: 245_000,
		},
	],
};

// Long, high-entropy prose with many UNIQUE entities so the chunker is forced to
// emit multiple body-N (oversized prose split past the per-chunk cap) and
// multiple entities-N (the entity summary exceeds the embed char budget).
const richBody = (): string =>
	Array.from(
		{ length: 200 },
		(_, i) =>
			`Section ${i}: the quarterly review covered revenue growth and detailed ` +
			`operational metrics across every region with specific commentary. ` +
			`Contact person${i}@example.com or open ` +
			`https://reports.example.com/region/${i}/full-quarterly-summary before ` +
			`2026-03-15 regarding the €${i},500 budget allocation under discussion.`,
	).join("\n\n");

describe("createEmailChunker producer/deleter parity", () => {
	const chunker = createEmailChunker();
	const parsedBody: ParsedBodyForChunking = { text: richBody(), html: null };
	const chunks = chunker.chunk({ envelope, parsedBody, messageId: MESSAGE_ID });

	it("exercises every chunk type with multiple body and entity chunks", () => {
		const types = new Set<ChunkType>(chunks.map((c) => c.chunkType));
		const expectedTypes: ChunkType[] = [
			"sender",
			"recipient",
			"subject",
			"attachment",
			"body",
			"entities",
		];
		for (const expected of expectedTypes) {
			assert.ok(types.has(expected), `missing chunk type: ${expected}`);
		}

		const bodyChunks = chunks.filter((c) => c.chunkId.includes("::body-"));
		const entityChunks = chunks.filter((c) =>
			c.chunkId.includes("::entities-"),
		);
		assert.ok(bodyChunks.length > 1, "expected multiple body-N chunks");
		assert.ok(entityChunks.length > 1, "expected multiple entities-N chunks");
	});

	it("emits only chunkIds the deleter can reap via candidateChunkKeys", () => {
		const reapable = new Set(candidateChunkKeys(MESSAGE_ID));
		for (const chunk of chunks) {
			assert.ok(
				reapable.has(chunk.chunkId),
				`produced chunkId ${chunk.chunkId} is not in candidateChunkKeys — ` +
					`the deleter can never reap it`,
			);
		}
	});
});
