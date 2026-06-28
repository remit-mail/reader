import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapSemanticSearchResult } from "@remit/api-http-client/types.gen.ts";
import {
	relatedSearchResults,
	semanticToSearchResult,
} from "./search-result.js";

function hit(
	overrides: Partial<RemitImapSemanticSearchResult> &
		Pick<RemitImapSemanticSearchResult, "messageId" | "threadId" | "score">,
): RemitImapSemanticSearchResult {
	return {
		matchedChunkType: "body",
		mailboxIds: [],
		...overrides,
	};
}

describe("semanticToSearchResult", () => {
	test("maps display fields and converts epoch seconds to ms", () => {
		const result = semanticToSearchResult(
			hit({
				messageId: "m1",
				threadId: "t1",
				score: 0.9,
				fromName: "Stripe",
				subject: "Invoice ready",
				sentDate: 1_700_000_000,
			}),
		);
		assert.strictEqual(result.id, "m1");
		assert.strictEqual(result.sender, "Stripe");
		assert.strictEqual(result.subject, "Invoice ready");
		assert.notStrictEqual(result.date, "");
	});

	test("falls back when denormalized display fields are absent", () => {
		const result = semanticToSearchResult(
			hit({ messageId: "m2", threadId: "t2", score: 0.5 }),
		);
		assert.strictEqual(result.sender, "Unknown");
		assert.strictEqual(result.subject, "(No subject)");
		assert.strictEqual(result.date, "");
	});
});

describe("relatedSearchResults", () => {
	test("orders by score descending", () => {
		const results = relatedSearchResults(
			[
				hit({ messageId: "m1", threadId: "t1", score: 0.2 }),
				hit({ messageId: "m2", threadId: "t2", score: 0.9 }),
				hit({ messageId: "m3", threadId: "t3", score: 0.5 }),
			],
			[],
		);
		assert.deepStrictEqual(
			results.map((r) => r.id),
			["m2", "m3", "m1"],
		);
	});

	test("excludes threads already shown under Top matches", () => {
		const results = relatedSearchResults(
			[
				hit({ messageId: "m1", threadId: "shared", score: 0.9 }),
				hit({ messageId: "m2", threadId: "t2", score: 0.5 }),
			],
			["shared"],
		);
		assert.deepStrictEqual(
			results.map((r) => r.id),
			["m2"],
		);
	});

	test("collapses multiple hits in the same thread to one row", () => {
		const results = relatedSearchResults(
			[
				hit({ messageId: "m1", threadId: "t1", score: 0.9 }),
				hit({ messageId: "m2", threadId: "t1", score: 0.4 }),
			],
			[],
		);
		assert.deepStrictEqual(
			results.map((r) => r.id),
			["m1"],
		);
	});
});
