import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UpdateAddressInput } from "@remit/api-openapi-types";
import { buildFlagsPatch } from "./address.js";

const trustedNow = {
	value: true,
	setAt: 1_700_000_000_000,
	setBy: "device-a",
};

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
