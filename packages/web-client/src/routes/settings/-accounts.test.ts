import assert from "node:assert";
import { describe, test } from "node:test";
import { mapOauthError } from "./accounts.tsx";

describe("mapOauthError", () => {
	test("access_denied returns cancellation message", () => {
		assert.strictEqual(
			mapOauthError("access_denied"),
			"You cancelled the sign-in.",
		);
	});

	test("ACCESS_DENIED is case-insensitive", () => {
		assert.strictEqual(
			mapOauthError("ACCESS_DENIED"),
			"You cancelled the sign-in.",
		);
	});

	test("consent_required returns admin consent message", () => {
		const result = mapOauthError("consent_required");
		assert.ok(
			result.toLowerCase().includes("admin"),
			`Expected admin hint, got: ${result}`,
		);
	});

	test("admin_consent_required returns admin consent message", () => {
		const result = mapOauthError("admin_consent_required");
		assert.ok(
			result.toLowerCase().includes("admin"),
			`Expected admin hint, got: ${result}`,
		);
	});

	test("interaction_required returns admin consent message", () => {
		const result = mapOauthError("interaction_required");
		assert.ok(
			result.toLowerCase().includes("admin"),
			`Expected admin hint, got: ${result}`,
		);
	});

	test("imap_disabled returns IMAP hint", () => {
		const result = mapOauthError("imap_disabled");
		assert.ok(
			result.toLowerCase().includes("imap"),
			`Expected IMAP hint, got: ${result}`,
		);
	});

	test("unknown code returns generic fallback with the code", () => {
		const result = mapOauthError("some_random_error");
		assert.ok(
			result.includes("some_random_error"),
			`Expected code in message, got: ${result}`,
		);
	});

	test("empty string returns generic fallback", () => {
		const result = mapOauthError("");
		assert.ok(typeof result === "string" && result.length > 0);
	});
});
