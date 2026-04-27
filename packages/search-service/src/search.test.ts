import assert from "node:assert";
import { describe, it } from "node:test";
import { MemoryVectorStore } from "./backends/memory.js";
import { createDeterministicEmbeddingService } from "./embeddings.js";
import { DefaultSearchService } from "./search.js";
import type { EnvelopeChunkInput, IndexEmailParams } from "./types.js";

const baseMetadata: IndexEmailParams["metadata"] = {
	messageId: "msg-1",
	threadId: "thread-1",
	accountConfigId: "acct-1",
	mailboxIds: ["mb-inbox"],
	sentDate: 1_700_000_000,
	isRead: false,
	hasAttachment: false,
	hasStars: false,
	fromEmail: "alice@example.com",
};

const aliceEnvelope: EnvelopeChunkInput = {
	from: { name: "Alice", email: "alice@example.com" },
	to: [{ name: "Bob", email: "bob@example.com" }],
	cc: [],
	bcc: [],
	subject: "Q1 invoice review",
	attachments: [],
};

const bobEnvelope: EnvelopeChunkInput = {
	from: { name: "Bob", email: "bob@example.com" },
	to: [{ name: "Carol", email: "carol@example.com" }],
	cc: [],
	bcc: [],
	subject: "Project kickoff next week",
	attachments: [
		{
			filename: "deck.pdf",
			contentType: "application/pdf",
			size: 100_000,
		},
	],
};

const buildService = () => {
	const store = new MemoryVectorStore();
	const embedder = createDeterministicEmbeddingService({ dimensions: 128 });
	const service = new DefaultSearchService({ embedder, store });
	return { service, store };
};

const indexBoth = async (svc: DefaultSearchService): Promise<void> => {
	await svc.index({
		envelope: aliceEnvelope,
		parsedBody: {
			text: "I have reviewed the Q1 numbers in the spreadsheet and the team exceeded the renewal target by fourteen percent across the portfolio.",
			html: null,
		},
		metadata: { ...baseMetadata, messageId: "msg-alice", threadId: "thread-a" },
	});
	await svc.index({
		envelope: bobEnvelope,
		parsedBody: {
			text: "Kicking off the new platform migration project next quarter, please join the planning session on Friday and bring your roadmap notes.",
			html: null,
		},
		metadata: {
			...baseMetadata,
			messageId: "msg-bob",
			threadId: "thread-b",
			fromEmail: "bob@example.com",
			hasAttachment: true,
		},
	});
};

describe("DefaultSearchService", () => {
	it("returns the email matching a sender name with the highest score", async () => {
		const { service } = buildService();
		await indexBoth(service);

		const results = await service.search({
			query: "alice",
			accountConfigId: "acct-1",
		});
		assert.ok(results.length > 0);
		assert.strictEqual(results[0].messageId, "msg-alice");
	});

	it("returns the email matching a recipient email address", async () => {
		const { service } = buildService();
		await indexBoth(service);

		const results = await service.search({
			query: "carol@example.com",
			accountConfigId: "acct-1",
		});
		assert.ok(results.length > 0);
		assert.strictEqual(results[0].messageId, "msg-bob");
	});

	it("dedupes by messageId so each message appears at most once", async () => {
		const { service } = buildService();
		await indexBoth(service);

		const results = await service.search({
			query: "alice",
			accountConfigId: "acct-1",
		});
		const ids = results.map((r) => r.messageId);
		assert.strictEqual(new Set(ids).size, ids.length);
	});

	it("filters by hasAttachment", async () => {
		const { service } = buildService();
		await indexBoth(service);

		const results = await service.search({
			query: "project",
			accountConfigId: "acct-1",
			hasAttachment: true,
		});
		assert.ok(results.every((r) => r.messageId === "msg-bob"));
	});

	it("removes all chunks for a deleted message", async () => {
		const { service, store } = buildService();
		await indexBoth(service);

		const before = await store.query({
			vector: new Array<number>(128).fill(0.1),
			topK: 100,
		});
		assert.ok(before.some((m) => m.metadata.messageId === "msg-alice"));

		await service.delete("msg-alice");

		const after = await store.query({
			vector: new Array<number>(128).fill(0.1),
			topK: 100,
		});
		assert.ok(!after.some((m) => m.metadata.messageId === "msg-alice"));
	});

	it("scopes results to a single accountConfigId", async () => {
		const { service } = buildService();
		await indexBoth(service);
		await service.index({
			envelope: aliceEnvelope,
			parsedBody: { text: null, html: null },
			metadata: {
				...baseMetadata,
				messageId: "msg-other-account",
				threadId: "thread-other",
				accountConfigId: "acct-2",
			},
		});

		const results = await service.search({
			query: "alice",
			accountConfigId: "acct-2",
		});
		assert.ok(results.length > 0);
		assert.ok(results.every((r) => r.messageId === "msg-other-account"));
	});
});
