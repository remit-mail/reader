import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SemanticSearchResult } from "@remit/api-openapi-types";
import type {
	SearchParams,
	SearchResult,
	SearchService,
} from "@remit/search-service";

interface CapturedSearch {
	calls: SearchParams[];
}

const buildFakeSearch = (
	results: SearchResult[],
): { service: SearchService; captured: CapturedSearch } => {
	const captured: CapturedSearch = { calls: [] };
	const service: SearchService = {
		index: async () => {},
		prepareVectors: async () => [],
		upsertVectors: async () => ({ upserted: 0, skipped: 0 }),
		indexIncremental: async () => ({ upserted: 0, skipped: 0 }),
		delete: async () => {},
		search: async (params) => {
			captured.calls.push(params);
			return results;
		},
	};
	return { service, captured };
};

const toResponse = (item: SearchResult): SemanticSearchResult => {
	const result: SemanticSearchResult = {
		messageId: item.messageId,
		threadId: item.threadId,
		score: item.score,
		matchedChunkType: item.matchedChunkType,
		mailboxIds: item.mailboxIds,
		sentDate: item.sentDate,
	};
	if (item.fromName !== undefined) {
		result.fromName = item.fromName ?? undefined;
	}
	if (item.subject !== undefined) {
		result.subject = item.subject;
	}
	return result;
};

describe("SemanticSearch handler response mapping", () => {
	it("maps SearchResult into SemanticSearchResult preserving all fields", () => {
		const item: SearchResult = {
			messageId: "msg-alice",
			threadId: "thread-a",
			score: 0.87,
			matchedChunkType: "sender",
			mailboxIds: ["mb-inbox", "mb-archive"],
			sentDate: 1_700_000_000,
		};
		const out = toResponse(item);
		assert.equal(out.messageId, "msg-alice");
		assert.equal(out.threadId, "thread-a");
		assert.equal(out.score, 0.87);
		assert.equal(out.matchedChunkType, "sender");
		assert.deepEqual(out.mailboxIds, ["mb-inbox", "mb-archive"]);
		assert.equal(out.sentDate, 1_700_000_000);
	});

	it("includes fromName and subject when present in SearchResult", () => {
		const item: SearchResult = {
			messageId: "msg-bob",
			threadId: "thread-b",
			score: 0.72,
			matchedChunkType: "body",
			mailboxIds: ["mb-inbox"],
			sentDate: 1_700_001_000,
			fromName: "Bob Smith",
			subject: "Weekly sync",
		};
		const out = toResponse(item);
		assert.equal(out.fromName, "Bob Smith");
		assert.equal(out.subject, "Weekly sync");
		assert.equal(out.sentDate, 1_700_001_000);
	});

	it("omits fromName when it is null (sender has no display name)", () => {
		const item: SearchResult = {
			messageId: "msg-carol",
			threadId: "thread-c",
			score: 0.6,
			matchedChunkType: "sender",
			mailboxIds: ["mb-inbox"],
			sentDate: 1_700_002_000,
			fromName: null,
			subject: "No-name sender",
		};
		const out = toResponse(item);
		assert.equal(out.fromName, undefined);
		assert.equal(out.subject, "No-name sender");
	});

	it("omits fromName and subject when absent (pre-enrichment vectors)", () => {
		const item: SearchResult = {
			messageId: "msg-legacy",
			threadId: "thread-legacy",
			score: 0.5,
			matchedChunkType: "body",
			mailboxIds: ["mb-archive"],
			sentDate: 1_600_000_000,
		};
		const out = toResponse(item);
		assert.equal(out.fromName, undefined);
		assert.equal(out.subject, undefined);
		assert.equal(out.sentDate, 1_600_000_000);
	});
});

describe("SemanticSearch handler search invocation", () => {
	it("forwards filters from the request to the search service", async () => {
		const { service, captured } = buildFakeSearch([
			{
				messageId: "msg-bob",
				threadId: "thread-b",
				score: 0.5,
				matchedChunkType: "body",
				mailboxIds: ["mb-inbox"],
				sentDate: 1_700_000_000,
			},
		]);

		const results = await service.search({
			query: "alice",
			accountConfigId: "acct-1",
			mailboxId: "mb-inbox",
			sentDateRange: { from: 100, to: 200 },
			hasAttachment: true,
			limit: 10,
		});

		assert.equal(results.length, 1);
		assert.equal(captured.calls.length, 1);
		const call = captured.calls[0];
		assert.equal(call.query, "alice");
		assert.equal(call.accountConfigId, "acct-1");
		assert.equal(call.mailboxId, "mb-inbox");
		assert.deepEqual(call.sentDateRange, { from: 100, to: 200 });
		assert.equal(call.hasAttachment, true);
		assert.equal(call.limit, 10);
	});
});
