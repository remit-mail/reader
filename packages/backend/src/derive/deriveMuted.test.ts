import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressFlags } from "@remit/api-openapi-types";
import { deriveMuted } from "./deriveMuted.js";

const SET_AT = 1_700_000_000_000;

describe("deriveMuted", () => {
	it("returns false when flags is undefined", () => {
		assert.equal(deriveMuted(undefined), false);
	});

	it("returns false for an empty flags object", () => {
		assert.equal(deriveMuted({}), false);
	});

	it("returns false when muted.value is false", () => {
		const flags: AddressFlags = { muted: { value: false, setAt: SET_AT } };
		assert.equal(deriveMuted(flags), false);
	});

	it("returns true when muted.value is true", () => {
		const flags: AddressFlags = { muted: { value: true, setAt: SET_AT } };
		assert.equal(deriveMuted(flags), true);
	});

	it("ignores other flags (orthogonal axis)", () => {
		const flags: AddressFlags = {
			vip: { value: true, setAt: SET_AT },
			wellknown: { value: true, setAt: SET_AT },
		};
		assert.equal(deriveMuted(flags), false);
	});
});
