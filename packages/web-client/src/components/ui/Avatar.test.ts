import assert from "node:assert";
import { describe, test } from "node:test";
import { computeColorClass, computeInitials } from "./avatar-utils.js";

describe("computeInitials", () => {
	test("uses first letter of first and last word of name", () => {
		assert.equal(computeInitials("Ada Lovelace"), "AL");
		assert.equal(computeInitials("Grace B Hopper"), "GH");
	});

	test("uses first two letters of single-word name", () => {
		assert.equal(computeInitials("Madonna"), "MA");
	});

	test("falls back to email local-part when name is missing", () => {
		assert.equal(
			computeInitials(undefined, "matthijs.vanhenten@example.com"),
			"MA",
		);
		assert.equal(computeInitials(undefined, "ada@example.com"), "AD");
	});

	test("returns ? when both inputs are missing or blank", () => {
		assert.equal(computeInitials(), "?");
		assert.equal(computeInitials("   "), "?");
		assert.equal(computeInitials("", ""), "?");
	});

	test("ignores common separators in names", () => {
		assert.equal(computeInitials("Jean-Luc Picard"), "JP");
		assert.equal(computeInitials("ada_lovelace"), "AL");
	});

	test("handles unicode characters as single graphemes", () => {
		assert.equal(computeInitials("Élise Müller"), "ÉM");
		assert.equal(computeInitials("张伟"), "张伟");
	});

	test("handles emoji as a single grapheme", () => {
		const result = computeInitials("🦄 Sparkles");
		assert.equal(result, "🦄S");
	});

	test("uppercases ASCII initials", () => {
		assert.equal(computeInitials("ada lovelace"), "AL");
	});
});

describe("computeColorClass", () => {
	test("returns a class from the palette", () => {
		const result = computeColorClass("Ada Lovelace", "ada@example.com");
		assert.match(
			result,
			/^bg-(red|amber|emerald|sky|violet|fuchsia|rose|cyan)-(600|700)$/,
		);
	});

	test("is deterministic for the same input", () => {
		const a = computeColorClass("Ada Lovelace", "ada@example.com");
		const b = computeColorClass("Ada Lovelace", "ada@example.com");
		assert.equal(a, b);
	});

	test("is case-insensitive on email", () => {
		const lower = computeColorClass(undefined, "ada@example.com");
		const mixed = computeColorClass(undefined, "Ada@Example.COM");
		assert.equal(lower, mixed);
	});

	test("prefers email over name so the same sender always matches", () => {
		const fromInbox = computeColorClass("Ada Lovelace", "ada@example.com");
		const fromSent = computeColorClass("A. Lovelace", "ada@example.com");
		assert.equal(fromInbox, fromSent);
	});

	test("distributes across the palette for varied inputs", () => {
		const inputs = [
			"a@example.com",
			"b@example.com",
			"c@example.com",
			"d@example.com",
			"e@example.com",
			"f@example.com",
			"g@example.com",
			"h@example.com",
			"i@example.com",
			"j@example.com",
			"k@example.com",
			"l@example.com",
			"m@example.com",
			"n@example.com",
			"o@example.com",
			"p@example.com",
		];
		const seen = new Set(inputs.map((e) => computeColorClass(undefined, e)));
		assert.ok(
			seen.size >= 5,
			`expected coverage of at least 5 palette colors, got ${seen.size}`,
		);
	});

	test("falls back to a stable default for empty inputs", () => {
		const a = computeColorClass();
		const b = computeColorClass("", "");
		assert.equal(a, b);
		assert.match(a, /^bg-/);
	});
});
