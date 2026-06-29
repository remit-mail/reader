import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressItem } from "@remit/remit-electrodb-service";
import type { UpdateAddressInput } from "@remit/api-openapi-types";
import { buildFlagsPatch, toAddressResponse } from "./address.js";

const trustedNow = {
	value: true,
	setAt: 1_700_000_000_000,
	setBy: "device-a",
};

const baseAddress: AddressItem = {
	addressId: "addr-1",
	accountConfigId: "cfg-1",
	displayName: "Alice",
	localPart: "alice",
	domain: "example.com",
	normalizedEmail: "alice@example.com",
	normalizedCompound: "alice alice@example.com",
	flags: undefined,
	inboundCount: 0,
	outboundCount: 0,
	replyCount: 0,
	lastInboundAt: 0,
	lastOutboundAt: undefined,
	lastReplyAt: 0,
	createdAt: 1_700_000_000_000,
	updatedAt: 1_700_000_001_000,
};

// A row written before the counters became required-with-default carries the
// attribute absent at runtime, even though the type now models them as total.
const unbackfilledAddress = {
	...baseAddress,
	inboundCount: undefined,
	outboundCount: undefined,
	replyCount: undefined,
	lastInboundAt: undefined,
	lastReplyAt: undefined,
} as unknown as AddressItem;

describe("toAddressResponse", () => {
	it("maps core fields", () => {
		const result = toAddressResponse(baseAddress);
		assert.equal(result.addressId, "addr-1");
		assert.equal(result.accountConfigId, "cfg-1");
		assert.equal(result.normalizedEmail, "alice@example.com");
	});

	it("defaults missing engagement counters to zero (un-backfilled row)", () => {
		const result = toAddressResponse(unbackfilledAddress);
		assert.equal(result.inboundCount, 0);
		assert.equal(result.outboundCount, 0);
		assert.equal(result.replyCount, 0);
		assert.equal(result.lastInboundAt, 0);
		assert.equal(result.lastReplyAt, 0);
	});

	it("maps engagement counters and timestamps when present", () => {
		const item: AddressItem = {
			...baseAddress,
			inboundCount: 34,
			outboundCount: 5,
			replyCount: 12,
			lastInboundAt: 1_700_000_002_000,
			lastReplyAt: 1_700_000_003_000,
		};
		const result = toAddressResponse(item);
		assert.equal(result.inboundCount, 34);
		assert.equal(result.outboundCount, 5);
		assert.equal(result.replyCount, 12);
		assert.equal(result.lastInboundAt, 1_700_000_002_000);
		assert.equal(result.lastReplyAt, 1_700_000_003_000);
	});
});

describe("buildFlagsPatch", () => {
	it("returns an empty patch for undefined input", () => {
		assert.deepEqual(buildFlagsPatch(undefined), {});
	});

	it("returns an empty patch for empty object", () => {
		assert.deepEqual(buildFlagsPatch({}), {});
	});

	it("forwards a single flag set", () => {
		const input: UpdateAddressInput["flags"] = { trusted: trustedNow };
		assert.deepEqual(buildFlagsPatch(input), { trusted: trustedNow });
	});

	it("forwards an explicit null as a remove signal", () => {
		const input = { trusted: null } as UpdateAddressInput["flags"];
		assert.deepEqual(buildFlagsPatch(input), { trusted: null });
	});

	it("preserves simultaneous set + remove of different flags", () => {
		const input = {
			trusted: trustedNow,
			blocked: null,
		} as UpdateAddressInput["flags"];
		assert.deepEqual(buildFlagsPatch(input), {
			trusted: trustedNow,
			blocked: null,
		});
	});

	it("ignores keys with undefined values (does not record absence)", () => {
		const input = { trusted: undefined } as UpdateAddressInput["flags"];
		assert.deepEqual(buildFlagsPatch(input), {});
	});

	it("drops unknown keys", () => {
		const input = {
			trusted: trustedNow,
			bogus: { value: true, setAt: 1 },
		} as unknown as UpdateAddressInput["flags"];
		assert.deepEqual(buildFlagsPatch(input), { trusted: trustedNow });
	});
});
