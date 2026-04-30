import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RemitImapVipSuggestionsResponse } from "@remit/api-http-client/types.gen.ts";
import { deriveSuggestedVipsState } from "./suggested-vips-state.js";

const populated: RemitImapVipSuggestionsResponse = {
	suggestions: [
		{
			addressId: "addr-alice",
			displayName: "Alice",
			normalizedEmail: "alice@example.com",
			inboundCount: 12,
			outboundCount: 4,
			replyCount: 2,
		},
	],
};

describe("deriveSuggestedVipsState", () => {
	test("returns loading while the query is in flight", () => {
		const state = deriveSuggestedVipsState({
			isPending: true,
			isError: false,
			error: null,
			data: undefined,
		});
		assert.equal(state.kind, "loading");
	});

	test("returns error when isError is true (distinct from empty per never-hide-failure)", () => {
		const fetchError = new Error("offline");
		const state = deriveSuggestedVipsState({
			isPending: false,
			isError: true,
			error: fetchError,
			data: undefined,
		});
		assert.equal(state.kind, "error");
		if (state.kind === "error") {
			assert.equal(state.error, fetchError);
		}
	});

	test("returns empty when the response carries an empty suggestions array", () => {
		const state = deriveSuggestedVipsState({
			isPending: false,
			isError: false,
			error: null,
			data: { suggestions: [] },
		});
		assert.equal(state.kind, "empty");
	});

	test("returns list with the response data when there are suggestions", () => {
		const state = deriveSuggestedVipsState({
			isPending: false,
			isError: false,
			error: null,
			data: populated,
		});
		assert.equal(state.kind, "list");
		if (state.kind === "list") {
			assert.equal(state.data.suggestions.length, 1);
			assert.equal(state.data.suggestions[0].addressId, "addr-alice");
		}
	});
});
