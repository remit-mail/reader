import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAllowedOrigins, resolveAllowOrigin } from "./cors.js";

describe("parseAllowedOrigins", () => {
	it("splits, trims, and drops empties", () => {
		assert.deepEqual(
			parseAllowedOrigins("https://a.example, https://b.example ,"),
			["https://a.example", "https://b.example"],
		);
	});

	it("returns an empty list for undefined or blank", () => {
		assert.deepEqual(parseAllowedOrigins(undefined), []);
		assert.deepEqual(parseAllowedOrigins("  "), []);
	});
});

describe("resolveAllowOrigin", () => {
	it("returns '*' when the allowlist contains a wildcard", () => {
		assert.equal(resolveAllowOrigin("https://any.example", ["*"]), "*");
		assert.equal(resolveAllowOrigin(undefined, ["*"]), "*");
	});

	it("reflects an allowlisted origin", () => {
		assert.equal(
			resolveAllowOrigin("https://app.example", [
				"https://app.example",
				"https://other.example",
			]),
			"https://app.example",
		);
	});

	it("returns undefined for an origin outside the allowlist", () => {
		assert.equal(
			resolveAllowOrigin("https://evil.example", ["https://app.example"]),
			undefined,
		);
	});

	it("returns undefined when no origin is presented and no wildcard", () => {
		assert.equal(
			resolveAllowOrigin(undefined, ["https://app.example"]),
			undefined,
		);
	});
});
