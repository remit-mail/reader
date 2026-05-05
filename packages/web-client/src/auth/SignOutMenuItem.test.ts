import assert from "node:assert";
import { describe, test } from "node:test";
import { isSignOutVisible } from "./sign-out-visibility";

describe("isSignOutVisible", () => {
	test("returns true when configured and authenticated", () => {
		assert.equal(
			isSignOutVisible({ configured: true, authStatus: "authenticated" }),
			true,
		);
	});

	test("returns false when cognito is not configured", () => {
		assert.equal(
			isSignOutVisible({ configured: false, authStatus: "authenticated" }),
			false,
		);
	});

	test("returns false when unauthenticated", () => {
		assert.equal(
			isSignOutVisible({ configured: true, authStatus: "unauthenticated" }),
			false,
		);
	});

	test("returns false while auth status is configuring", () => {
		assert.equal(
			isSignOutVisible({ configured: true, authStatus: "configuring" }),
			false,
		);
	});

	test("returns false when auth status is undefined", () => {
		assert.equal(
			isSignOutVisible({ configured: true, authStatus: undefined }),
			false,
		);
	});
});
