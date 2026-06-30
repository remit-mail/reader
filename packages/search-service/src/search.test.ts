import assert from "node:assert";
import { describe, it } from "node:test";
import {
	MemoryVectorStore,
	type VectorStoreService,
} from "./backends/memory.js";
import { createDeterministicEmbeddingService } from "./embeddings.js";
import { DefaultSearchService } from "./search.js";
import type {
	EnvelopeChunkInput,
	IndexEmailParams,
	VectorMatch,
	VectorQuery,
	VectorRecord,
} from "./types.js";

const baseMetadata: IndexEmailParams["metadata"] = {
	messageId: "msg-1",
	threadId: "thread-1",
	accountConfigId: "acct-1",
	mailboxIds: ["mb-inbox"],
	sentDate: 1_700_000_000,
	isRead: false,
	hasAttachment: false,
	hasStars: false,
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
		metadata: {
			...baseMetadata,
			messageId: "msg-alice",
			threadId: "thread-a",
			fromName: "Alice",
			subject: "Q1 invoice review",
		},
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
			hasAttachment: true,
			fromName: "Bob",
			subject: "Project kickoff next week",
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

	it("returns fromName, subject, and sentDate in search results", async () => {
		const { service } = buildService();
		await indexBoth(service);

		const results = await service.search({
			query: "alice invoice",
			accountConfigId: "acct-1",
		});
		assert.ok(results.length > 0);
		const alice = results.find((r) => r.messageId === "msg-alice");
		assert.ok(alice, "msg-alice should be in results");
		assert.strictEqual(alice.fromName, "Alice");
		assert.strictEqual(alice.subject, "Q1 invoice review");
		assert.strictEqual(alice.sentDate, 1_700_000_000);
	});

	it("omits fromName and subject when not stored in metadata (pre-enrichment vectors)", async () => {
		const { service } = buildService();
		// Index without display fields to simulate pre-enrichment vectors
		await service.index({
			envelope: aliceEnvelope,
			parsedBody: {
				text: "Pre-enrichment message content with enough substance to index",
				html: null,
			},
			metadata: {
				...baseMetadata,
				messageId: "msg-legacy",
				threadId: "thread-legacy",
			},
		});

		const results = await service.search({
			query: "pre-enrichment message",
			accountConfigId: "acct-1",
		});
		const legacy = results.find((r) => r.messageId === "msg-legacy");
		assert.ok(legacy, "msg-legacy should be in results");
		assert.strictEqual(legacy.sentDate, 1_700_000_000);
		// fromName and subject should be absent for pre-enrichment vectors
		assert.strictEqual(legacy.fromName, undefined);
		assert.strictEqual(legacy.subject, undefined);
	});
});

// Counts every vector handed to the store's upsert, so a re-index that writes
// nothing can be asserted as exactly zero PutVectors-bound records.
class SpyStore implements VectorStoreService {
	private inner = new MemoryVectorStore();
	writes: VectorRecord[][] = [];

	upsert = async (vectors: VectorRecord[]): Promise<void> => {
		this.writes.push(vectors);
		await this.inner.upsert(vectors);
	};
	query = (params: VectorQuery): Promise<VectorMatch[]> =>
		this.inner.query(params);
	delete = (filter: { messageId: string }): Promise<void> =>
		this.inner.delete(filter);
	existingContentHashes = (chunkIds: string[]): Promise<Map<string, string>> =>
		this.inner.existingContentHashes(chunkIds);

	written = (): number => this.writes.reduce((n, b) => n + b.length, 0);
	reset = (): void => {
		this.writes = [];
	};
}

const invoiceBody =
	"I have reviewed the Q1 numbers in the spreadsheet and the team exceeded the renewal target by fourteen percent across the portfolio.";

const aliceParams = (body: string): IndexEmailParams => ({
	envelope: aliceEnvelope,
	parsedBody: { text: body, html: null },
	metadata: {
		...baseMetadata,
		messageId: "msg-alice",
		threadId: "thread-a",
		fromName: "Alice",
		subject: "Q1 invoice review",
	},
});

describe("DefaultSearchService idempotent indexing", () => {
	it("(a) a re-index of unchanged content writes zero vectors", async () => {
		const store = new SpyStore();
		const embedder = createDeterministicEmbeddingService({ dimensions: 128 });
		const service = new DefaultSearchService({ embedder, store });

		await service.index(aliceParams(invoiceBody));
		assert.ok(store.written() > 0, "first index writes the message's chunks");

		store.reset();
		await service.index(aliceParams(invoiceBody));
		assert.strictEqual(
			store.written(),
			0,
			"unchanged re-index must write nothing",
		);
	});

	it("(b) changed body content re-PUTs", async () => {
		const store = new SpyStore();
		const embedder = createDeterministicEmbeddingService({ dimensions: 128 });
		const service = new DefaultSearchService({ embedder, store });

		await service.index(aliceParams(invoiceBody));
		store.reset();

		await service.index(
			aliceParams(
				"Completely different content: the renovation budget overran and we must escalate the vendor dispute before the quarter closes.",
			),
		);
		assert.ok(store.written() > 0, "changed content must re-PUT the chunks");
	});

	it("(c) an embedding model/version bump re-PUTs", async () => {
		const store = new SpyStore();
		const service128 = new DefaultSearchService({
			embedder: createDeterministicEmbeddingService({ dimensions: 128 }),
			store,
		});
		await service128.index(aliceParams(invoiceBody));
		store.reset();

		// Same store, same content, different embedding id (dimensions change).
		const service256 = new DefaultSearchService({
			embedder: createDeterministicEmbeddingService({ dimensions: 256 }),
			store,
		});
		await service256.index(aliceParams(invoiceBody));
		assert.ok(
			store.written() > 0,
			"a model/dimension change must invalidate the hash and re-embed",
		);
	});

	it("(d) force re-PUTs unchanged content regardless", async () => {
		const store = new SpyStore();
		const embedder = createDeterministicEmbeddingService({ dimensions: 128 });
		const service = new DefaultSearchService({ embedder, store });

		const records = await service.prepareVectors(aliceParams(invoiceBody));
		await service.upsertVectors(records);
		store.reset();

		const skipResult = await service.upsertVectors(records);
		assert.strictEqual(skipResult.upserted, 0, "unchanged upsert skips all");
		assert.strictEqual(store.written(), 0);

		const forceResult = await service.upsertVectors(records, { force: true });
		assert.strictEqual(
			forceResult.upserted,
			records.length,
			"force re-PUTs every record",
		);
		assert.strictEqual(store.written(), records.length);
	});
});
