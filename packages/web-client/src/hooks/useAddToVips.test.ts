import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RemitImapVipSuggestionsResponse } from "@remit/api-http-client/types.gen.ts";
import { buildVipFlag, removeAddressFromSuggestions } from "./useAddToVips";

const NOW = 1_700_000_000_000;

const sample = (): RemitImapVipSuggestionsResponse => ({
	suggestions: [
		{
			addressId: "addr-alice",
			displayName: "Alice",
			normalizedEmail: "alice@example.com",
			inboundCount: 12,
			outboundCount: 4,
			replyCount: 2,
		},
		{
			addressId: "addr-bob",
			displayName: "Bob",
			normalizedEmail: "bob@example.com",
			inboundCount: 5,
			outboundCount: 1,
			replyCount: 1,
		},
	],
});

describe("buildVipFlag", () => {
	test("stamps value=true and setBy=user", () => {
		const flag = buildVipFlag(NOW);
		assert.equal(flag.value, true);
		assert.equal(flag.setAt, NOW);
		assert.equal(flag.setBy, "user");
	});

	test("defaults setAt to Date.now() when omitted", () => {
		const before = Date.now();
		const flag = buildVipFlag();
		const after = Date.now();
		assert.ok(flag.setAt >= before && flag.setAt <= after);
	});
});

describe("removeAddressFromSuggestions", () => {
	test("filters out the matching addressId", () => {
		const next = removeAddressFromSuggestions(sample(), "addr-alice");
		assert.equal(next.suggestions.length, 1);
		assert.equal(next.suggestions[0].addressId, "addr-bob");
	});

	test("returns the same shape when the addressId is not in the list", () => {
		const next = removeAddressFromSuggestions(sample(), "addr-other");
		assert.equal(next.suggestions.length, 2);
	});

	test("does not mutate the input list", () => {
		const data = sample();
		removeAddressFromSuggestions(data, "addr-alice");
		assert.equal(data.suggestions.length, 2);
	});
});
