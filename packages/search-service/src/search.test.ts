import assert from "node:assert";
import { describe, it } from "node:test";
import {
	MemoryVectorStore,
	type VectorStoreService,
} from "./backends/memory.js";
import {
	createDeterministicEmbeddingService,
	type EmbeddingService,
} from "./embeddings.js";
import {
	buildTextPreview,
	DefaultSearchService,
	literalMatchScore,
	rerank,
	tokenizeQuery,
	truncateUtf8Bytes,
} from "./search.js";
import type {
	ChunkMetadata,
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

	it("category filter returns only in-category hits", async () => {
		const { service } = buildService();
		await service.index({
			envelope: aliceEnvelope,
			parsedBody: {
				text: "Quarterly renewal figures and the invoice reconciliation for the finance team review.",
				html: null,
			},
			metadata: {
				...baseMetadata,
				messageId: "msg-personal",
				threadId: "thread-personal",
				category: "personal",
			},
		});
		await service.index({
			envelope: aliceEnvelope,
			parsedBody: {
				text: "Weekly renewal newsletter roundup with the invoice highlights and finance stories for subscribers.",
				html: null,
			},
			metadata: {
				...baseMetadata,
				messageId: "msg-newsletter",
				threadId: "thread-newsletter",
				category: "newsletter",
			},
		});

		const scoped = await service.search({
			query: "renewal invoice finance",
			accountConfigId: "acct-1",
			category: "newsletter",
		});
		assert.ok(scoped.length > 0);
		assert.ok(
			scoped.every((r) => r.category === "newsletter"),
			"every hit must be in the requested category",
		);
	});

	// The real invariant is that a category filter only removes out-of-category
	// hits from the candidate window — it never adds or reorders. It is NOT that
	// `related(all)` limited to the top-N contains every scoped hit: with a large
	// corpus both queries pull the same topK window then slice to `limit` by
	// score, so an in-category hit ranked below the global top-N appears in the
	// scoped result but not in the limited all-category result. That divergence
	// is the point of the feature. We test the invariant against the full
	// candidate window (a limit large enough that nothing is sliced off).
	it("scoped hits are a subset of the same unsliced all-category window", async () => {
		const { service } = buildService();
		// Several strongly-matching personal messages that outrank the one
		// newsletter, plus the newsletter itself. With a small all-limit the
		// newsletter falls outside the top-N; the category scope surfaces it.
		for (let i = 0; i < 5; i++) {
			await service.index({
				envelope: aliceEnvelope,
				parsedBody: {
					text: "Quarterly renewal invoice finance reconciliation for the finance team quarterly review.",
					html: null,
				},
				metadata: {
					...baseMetadata,
					messageId: `msg-personal-${i}`,
					threadId: `thread-personal-${i}`,
					category: "personal",
				},
			});
		}
		await service.index({
			envelope: aliceEnvelope,
			parsedBody: {
				text: "Weekly roundup newsletter mentioning renewal and a finance story for subscribers.",
				html: null,
			},
			metadata: {
				...baseMetadata,
				messageId: "msg-newsletter",
				threadId: "thread-newsletter",
				category: "newsletter",
			},
		});

		const allFull = await service.search({
			query: "renewal invoice finance",
			accountConfigId: "acct-1",
			limit: 100,
		});
		const scoped = await service.search({
			query: "renewal invoice finance",
			accountConfigId: "acct-1",
			category: "newsletter",
			limit: 100,
		});

		const allIds = new Set(allFull.map((r) => r.messageId));
		assert.ok(scoped.length > 0);
		assert.ok(
			scoped.every((r) => allIds.has(r.messageId)),
			"every scoped hit must appear in the full (unsliced) all-category window",
		);
		assert.ok(
			scoped.every((r) => r.category === "newsletter"),
			"the scoped result is filtered to the requested category only",
		);
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
	getByMessage = (messageId: string): Promise<VectorRecord[]> =>
		this.inner.getByMessage(messageId);

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

class CountingEmbedder implements EmbeddingService {
	readonly embeddingId: string;
	readonly dimensions: number;
	private inner: EmbeddingService;
	embedCalls = 0;
	embeddedTexts = 0;
	constructor(dimensions = 128) {
		this.inner = createDeterministicEmbeddingService({ dimensions });
		this.embeddingId = this.inner.embeddingId;
		this.dimensions = this.inner.dimensions;
	}
	embed = async (texts: string[]): Promise<number[][]> => {
		this.embedCalls += 1;
		this.embeddedTexts += texts.length;
		return this.inner.embed(texts);
	};
}

describe("DefaultSearchService.indexIncremental", () => {
	it("does not embed when content is unchanged and already indexed", async () => {
		const store = new SpyStore();
		const embedder = new CountingEmbedder();
		const service = new DefaultSearchService({ embedder, store });

		const first = await service.indexIncremental(aliceParams(invoiceBody));
		assert.ok(first.upserted > 0, "first index embeds and writes");
		assert.ok(embedder.embedCalls > 0);

		embedder.embedCalls = 0;
		store.reset();
		const second = await service.indexIncremental(aliceParams(invoiceBody));
		assert.strictEqual(embedder.embedCalls, 0, "unchanged: no embedding pass");
		assert.strictEqual(store.written(), 0, "unchanged: nothing written");
		assert.strictEqual(second.upserted, 0);
		assert.ok(second.skipped > 0, "unchanged chunks are counted as skipped");
	});

	it("embeds only the changed chunks when the body changes", async () => {
		const store = new SpyStore();
		const embedder = new CountingEmbedder();
		const service = new DefaultSearchService({ embedder, store });

		await service.indexIncremental(aliceParams(invoiceBody));
		embedder.embedCalls = 0;
		store.reset();

		const changed = await service.indexIncremental(
			aliceParams(
				"Completely different content: the renovation budget overran and we must escalate the vendor dispute before the quarter closes.",
			),
		);
		assert.ok(embedder.embedCalls > 0, "changed content re-embeds");
		assert.ok(changed.upserted > 0, "changed content is written");
	});

	it("force re-embeds every chunk even when unchanged (move metadata refresh)", async () => {
		const store = new SpyStore();
		const embedder = new CountingEmbedder();
		const service = new DefaultSearchService({ embedder, store });

		await service.indexIncremental(aliceParams(invoiceBody));
		embedder.embedCalls = 0;
		store.reset();

		const forced = await service.indexIncremental(aliceParams(invoiceBody), {
			force: true,
		});
		assert.ok(embedder.embedCalls > 0, "force embeds regardless of hash");
		assert.ok(forced.upserted > 0, "force re-writes every chunk");
		assert.strictEqual(forced.skipped, 0);
	});
});

const buildMatch = (
	overrides: Omit<Partial<VectorMatch>, "metadata"> & {
		metadata?: Partial<ChunkMetadata>;
	},
): VectorMatch => ({
	chunkId: overrides.chunkId ?? "chunk-1",
	score: overrides.score ?? 0.5,
	metadata: {
		messageId: "msg-1",
		threadId: "thread-1",
		accountConfigId: "acct-1",
		mailboxIds: ["mb-inbox"],
		chunkType: "body",
		sentDate: 1_700_000_000,
		isRead: false,
		hasAttachment: false,
		hasStars: false,
		...overrides.metadata,
	},
});

describe("tokenizeQuery", () => {
	it("lowercases and whitespace-splits", () => {
		assert.deepStrictEqual(tokenizeQuery("Invoice NUMBER"), [
			"invoice",
			"number",
		]);
	});

	it("drops tokens shorter than 3 characters", () => {
		assert.deepStrictEqual(tokenizeQuery("a to inv-98234"), ["inv-98234"]);
	});

	it("caps at 8 tokens", () => {
		const query = Array.from({ length: 12 }, (_, i) => `word${i}`).join(" ");
		assert.strictEqual(tokenizeQuery(query).length, 8);
	});
});

describe("truncateUtf8Bytes", () => {
	it("returns the string unchanged when it already fits the byte budget", () => {
		assert.strictEqual(truncateUtf8Bytes("hello world", 100), "hello world");
	});

	it("truncates ASCII text to exactly the byte budget", () => {
		const text = "a".repeat(100);
		const truncated = truncateUtf8Bytes(text, 40);
		assert.strictEqual(Buffer.byteLength(truncated, "utf8"), 40);
	});

	it("never splits a multi-byte CJK character (stays valid UTF-8, no replacement char)", () => {
		// Each character is a 3-byte UTF-8 CJK ideograph; a byte budget that isn't a
		// multiple of 3 forces the truncator to back off mid-sequence.
		const text = "書".repeat(50);
		const truncated = truncateUtf8Bytes(text, 41);
		assert.ok(Buffer.byteLength(truncated, "utf8") <= 41);
		assert.ok(
			!truncated.includes("�"),
			"must not contain the UTF-8 replacement character",
		);
		assert.strictEqual(
			Buffer.from(truncated, "utf8").toString("utf8"),
			truncated,
			"must round-trip through UTF-8 unchanged",
		);
	});

	it("never splits a surrogate pair (4-byte UTF-8 emoji)", () => {
		const text = "😀".repeat(50);
		const truncated = truncateUtf8Bytes(text, 41);
		assert.ok(Buffer.byteLength(truncated, "utf8") <= 41);
		assert.ok(!truncated.includes("�"));
		assert.strictEqual(
			Buffer.from(truncated, "utf8").toString("utf8"),
			truncated,
		);
		// A lone surrogate half would fail a round-trip through encodeURIComponent.
		assert.doesNotThrow(() => encodeURIComponent(truncated));
	});

	it("returns an empty string when the budget is smaller than any single character", () => {
		assert.strictEqual(truncateUtf8Bytes("書".repeat(10), 2), "");
	});
});

describe("buildTextPreview", () => {
	it("keeps a 512+ char CJK chunk under the byte budget and valid UTF-8", () => {
		// 3 bytes/char in UTF-8; 600 chars is well past both the 512-char cap and
		// the byte budget, so both bounds are exercised.
		const cjkChunk = "取引先への請求書を添付いたします。".repeat(40);
		assert.ok(cjkChunk.length > 512);

		const preview = buildTextPreview(cjkChunk);

		assert.ok(
			Buffer.byteLength(preview, "utf8") <= 700,
			`preview is ${Buffer.byteLength(preview, "utf8")} bytes, expected <= 700`,
		);
		assert.ok(!preview.includes("�"));
		assert.strictEqual(Buffer.from(preview, "utf8").toString("utf8"), preview);
	});

	it("does not shorten a plain-ASCII 512-char preview (byte cap does not bite the common case)", () => {
		const asciiChunk = "invoice payment reconciliation ".repeat(20);
		assert.ok(asciiChunk.length > 512);

		const preview = buildTextPreview(asciiChunk);

		assert.strictEqual(preview.length, 512);
		assert.strictEqual(preview, asciiChunk.slice(0, 512));
	});
});

describe("literalMatchScore", () => {
	it("returns undefined when textPreview is absent (missing-preview neutrality)", () => {
		assert.strictEqual(literalMatchScore(["invoice"], undefined), undefined);
	});

	it("returns undefined when there are no qualifying query tokens", () => {
		assert.strictEqual(literalMatchScore([], "some preview text"), undefined);
	});

	it("is case-insensitive", () => {
		assert.strictEqual(
			literalMatchScore(["invoice"], "Your INVOICE is attached"),
			1,
		);
	});

	it("scores the fraction of tokens found as substrings", () => {
		assert.strictEqual(
			literalMatchScore(
				["invoice", "number", "zzz"],
				"the invoice number is 42",
			),
			2 / 3,
		);
	});

	it("returns 0 when no tokens match", () => {
		assert.strictEqual(
			literalMatchScore(["invoice"], "completely unrelated content"),
			0,
		);
	});
});

describe("rerank", () => {
	it("ranks an exact literal match above a semantically-similar but literal-miss chunk", () => {
		const literalHit = buildMatch({
			chunkId: "chunk-literal",
			score: 0.5,
			metadata: {
				messageId: "msg-literal",
				textPreview: "Please see invoice INV-98234 attached for payment.",
			},
		});
		const semanticNearMiss = buildMatch({
			chunkId: "chunk-semantic",
			score: 0.9,
			metadata: {
				messageId: "msg-semantic",
				textPreview:
					"Here is the billing statement for this quarter's charges.",
			},
		});

		const [first, second] = rerank(
			[semanticNearMiss, literalHit],
			"INV-98234",
		).sort((a, b) => b.score - a.score);

		assert.strictEqual(first.metadata.messageId, "msg-literal");
		assert.strictEqual(second.metadata.messageId, "msg-semantic");
	});

	it("leaves cosine score untouched when textPreview is missing (score-neutral)", () => {
		const legacy = buildMatch({
			score: 0.42,
			metadata: { textPreview: undefined },
		});

		const [result] = rerank([legacy], "invoice INV-98234");
		assert.strictEqual(result.score, 0.42);
	});

	it("blends 40% cosine and 60% literal when a preview is present", () => {
		const match = buildMatch({
			score: 0.5,
			metadata: { textPreview: "invoice inv-98234 attached" },
		});

		const [result] = rerank([match], "inv-98234");
		assert.strictEqual(result.score, 0.4 * 0.5 + 0.6 * 1);
	});
});

describe("DefaultSearchService.search hybrid re-ranking (integration)", () => {
	it("ranks a message containing a literal query string first", async () => {
		const { service } = buildService();
		await service.index({
			envelope: aliceEnvelope,
			parsedBody: {
				text: "Please process invoice INV-98234 for the March renewal before month end.",
				html: null,
			},
			metadata: {
				...baseMetadata,
				messageId: "msg-literal-invoice",
				threadId: "thread-literal",
				fromName: "Alice",
				subject: "Invoice INV-98234",
			},
		});
		await service.index({
			envelope: bobEnvelope,
			parsedBody: {
				text: "Billing and payment reconciliation for the quarterly renewal cycle across all accounts.",
				html: null,
			},
			metadata: {
				...baseMetadata,
				messageId: "msg-semantic-only",
				threadId: "thread-semantic",
				fromName: "Bob",
				subject: "Quarterly billing reconciliation",
			},
		});

		const results = await service.search({
			query: "INV-98234",
			accountConfigId: "acct-1",
		});

		assert.ok(results.length > 0);
		assert.strictEqual(results[0].messageId, "msg-literal-invoice");
	});
});
