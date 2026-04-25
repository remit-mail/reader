import assert from "node:assert";
import { describe, test } from "node:test";
import { deriveUseDifferentSmtpCreds } from "./AccountFormPanel.tsx";

describe("deriveUseDifferentSmtpCreds", () => {
	test("returns true when smtpUsername differs from username", () => {
		const result = deriveUseDifferentSmtpCreds({
			username: "alice@example.com",
			smtpUsername: "smtp-alice@example.com",
		});
		assert.strictEqual(result, true);
	});

	test("returns false when smtpUsername equals username", () => {
		const result = deriveUseDifferentSmtpCreds({
			username: "alice@example.com",
			smtpUsername: "alice@example.com",
		});
		assert.strictEqual(result, false);
	});

	test("returns false when smtpUsername is undefined", () => {
		const result = deriveUseDifferentSmtpCreds({
			username: "alice@example.com",
			smtpUsername: undefined,
		});
		assert.strictEqual(result, false);
	});

	test("returns false when smtpUsername is empty string", () => {
		const result = deriveUseDifferentSmtpCreds({
			username: "alice@example.com",
			smtpUsername: "",
		});
		assert.strictEqual(result, false);
	});

	test("returns false when smtpUsername is whitespace", () => {
		const result = deriveUseDifferentSmtpCreds({
			username: "alice@example.com",
			smtpUsername: "   ",
		});
		assert.strictEqual(result, false);
	});

	test("trims whitespace before comparing", () => {
		const result = deriveUseDifferentSmtpCreds({
			username: "alice@example.com",
			smtpUsername: "  alice@example.com  ",
		});
		assert.strictEqual(result, false);
	});
});
