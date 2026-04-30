import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatVipSuggestionStats } from "./vip-suggestion-stats";

describe("formatVipSuggestionStats", () => {
	test("verbose joiner: 12 received · 4 sent · 2 replies", () => {
		assert.equal(
			formatVipSuggestionStats({
				inboundCount: 12,
				outboundCount: 4,
				replyCount: 2,
			}),
			"12 received · 4 sent · 2 replies",
		);
	});

	test("singular reply uses 'reply' not 'replies'", () => {
		assert.equal(
			formatVipSuggestionStats({
				inboundCount: 3,
				outboundCount: 1,
				replyCount: 1,
			}),
			"3 received · 1 sent · 1 reply",
		);
	});

	test("zero-valued segments are dropped", () => {
		assert.equal(
			formatVipSuggestionStats({
				inboundCount: 5,
				outboundCount: 0,
				replyCount: 1,
			}),
			"5 received · 1 reply",
		);
	});

	test("returns empty string when all counters are zero", () => {
		assert.equal(
			formatVipSuggestionStats({
				inboundCount: 0,
				outboundCount: 0,
				replyCount: 0,
			}),
			"",
		);
	});
});
