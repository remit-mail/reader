import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapAddressResponse } from "@remit/api-http-client/types.gen.ts";
import {
	pickSenderAddress,
	SENDER_ADDRESS_SEARCH_LIMIT,
	senderAddressSearchQuery,
} from "./sender-address";

const address = (
	addressId: string,
	normalizedEmail: string,
): RemitImapAddressResponse =>
	({ addressId, normalizedEmail }) as RemitImapAddressResponse;

describe("senderAddressSearchQuery", () => {
	it("lowercases the address and asks for a window, not one row", () => {
		assert.deepEqual(senderAddressSearchQuery("Support@NPMJS.com"), {
			q: "support@npmjs.com",
			limit: SENDER_ADDRESS_SEARCH_LIMIT,
		});
		assert.ok(SENDER_ADDRESS_SEARCH_LIMIT > 1);
	});

	it("is stable for a missing sender, so the cache key stays valid", () => {
		assert.deepEqual(senderAddressSearchQuery(undefined), {
			q: "",
			limit: SENDER_ADDRESS_SEARCH_LIMIT,
		});
	});
});

describe("pickSenderAddress", () => {
	it("picks the exact address, not the first prefix match", () => {
		const items = [
			address("other", "sup@npmjs.com"),
			address("wanted", "support@npmjs.com"),
		];
		assert.equal(
			pickSenderAddress(items, "support@npmjs.com")?.addressId,
			"wanted",
		);
	});

	it("matches case-insensitively", () => {
		const items = [address("wanted", "support@npmjs.com")];
		assert.equal(
			pickSenderAddress(items, "Support@NPMJS.com")?.addressId,
			"wanted",
		);
	});

	it("resolves to undefined rather than the wrong sender", () => {
		const items = [address("other", "sup@npmjs.com")];
		assert.equal(pickSenderAddress(items, "support@npmjs.com"), undefined);
		assert.equal(pickSenderAddress([], "support@npmjs.com"), undefined);
		assert.equal(pickSenderAddress(undefined, "support@npmjs.com"), undefined);
		assert.equal(pickSenderAddress(items, undefined), undefined);
	});
});
