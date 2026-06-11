import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressFlags } from "@remit/api-openapi-types";
import { deriveSenderTrust } from "./senderTrust.js";

// AddressFlagBase requires setAt; deriveSenderTrust only reads `value`, so the
// timestamp value is irrelevant to these assertions.
const SET_AT = 1_700_000_000_000;

describe("deriveSenderTrust", () => {
	it("returns 'unknown' when flags is undefined", () => {
		assert.equal(deriveSenderTrust(undefined), "unknown");
	});

	it("returns 'unknown' for an empty flags object", () => {
		assert.equal(deriveSenderTrust({}), "unknown");
	});

	it("returns 'unknown' when wellknown.value is false", () => {
		const flags: AddressFlags = { wellknown: { value: false, setAt: SET_AT } };
		assert.equal(deriveSenderTrust(flags), "unknown");
	});

	it("returns 'wellknown' when wellknown.value is true", () => {
		const flags: AddressFlags = { wellknown: { value: true, setAt: SET_AT } };
		assert.equal(deriveSenderTrust(flags), "wellknown");
	});

	it("returns 'vip' when vip.value is true", () => {
		const flags: AddressFlags = { vip: { value: true, setAt: SET_AT } };
		assert.equal(deriveSenderTrust(flags), "vip");
	});

	it("returns 'unknown' when vip.value is false", () => {
		const flags: AddressFlags = { vip: { value: false, setAt: SET_AT } };
		assert.equal(deriveSenderTrust(flags), "unknown");
	});

	it("vip wins over wellknown when both are true", () => {
		const flags: AddressFlags = {
			vip: { value: true, setAt: SET_AT },
			wellknown: { value: true, setAt: SET_AT },
		};
		assert.equal(deriveSenderTrust(flags), "vip");
	});

	it("falls back to wellknown when vip is false but wellknown is true", () => {
		const flags: AddressFlags = {
			vip: { value: false, setAt: SET_AT },
			wellknown: { value: true, setAt: SET_AT },
		};
		assert.equal(deriveSenderTrust(flags), "wellknown");
	});

	it("ignores trusted flag (orthogonal axis)", () => {
		const flags: AddressFlags = { trusted: { value: true, setAt: SET_AT } };
		assert.equal(deriveSenderTrust(flags), "unknown");
	});

	it("ignores trusted even when wellknown is also set", () => {
		const flags: AddressFlags = {
			trusted: { value: true, setAt: SET_AT },
			wellknown: { value: true, setAt: SET_AT },
		};
		assert.equal(deriveSenderTrust(flags), "wellknown");
	});
});
