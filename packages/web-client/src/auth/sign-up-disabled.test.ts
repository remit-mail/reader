import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isSignUpDisabledError,
	SIGN_UP_DISABLED_CODE,
} from "./better-auth-config";

describe("isSignUpDisabledError", () => {
	it("recognises better-auth's closed-signup rejection by code", () => {
		assert.equal(
			isSignUpDisabledError({ code: SIGN_UP_DISABLED_CODE, status: 400 }),
			true,
		);
	});

	it("ignores any other error or non-object", () => {
		assert.equal(isSignUpDisabledError({ code: "INVALID_EMAIL" }), false);
		assert.equal(isSignUpDisabledError(new Error("network down")), false);
		assert.equal(isSignUpDisabledError(null), false);
		assert.equal(isSignUpDisabledError(undefined), false);
		assert.equal(isSignUpDisabledError("nope"), false);
	});
});
