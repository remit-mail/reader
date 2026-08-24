import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAddressInput } from "./parse-address-input.js";

describe("parseAddressInput", () => {
	it("reads a bare address", () => {
		assert.deepEqual(parseAddressInput("ada@example.com"), {
			entries: [{ email: "ada@example.com" }],
			unparsed: "",
		});
	});

	it("reads a display name and the address it wraps", () => {
		assert.deepEqual(parseAddressInput("Ada Lovelace <ada@example.com>"), {
			entries: [{ email: "ada@example.com", displayName: "Ada Lovelace" }],
			unparsed: "",
		});
	});

	it("reads a pasted list", () => {
		assert.deepEqual(
			parseAddressInput("alice@example.com, bob@example.com").entries,
			[{ email: "alice@example.com" }, { email: "bob@example.com" }],
		);
	});

	it("takes a semicolon as a separator too", () => {
		assert.equal(
			parseAddressInput("alice@example.com; bob@example.com").entries.length,
			2,
		);
	});

	it("keeps a quoted display name whole", () => {
		assert.deepEqual(parseAddressInput('"Hopper, Grace" <grace@example.com>'), {
			entries: [{ email: "grace@example.com", displayName: "Hopper, Grace" }],
			unparsed: "",
		});
	});

	it("keeps what is not an address rather than dropping it", () => {
		assert.deepEqual(parseAddressInput("not-an-address"), {
			entries: [],
			unparsed: "not-an-address",
		});
	});

	it("separates the addresses in a list from what is not one", () => {
		assert.deepEqual(parseAddressInput("bob@example.com, alice@example"), {
			entries: [{ email: "bob@example.com" }],
			unparsed: "alice@example",
		});
	});

	it("reports every leftover, not only the first", () => {
		assert.equal(
			parseAddressInput("one, bob@example.com, two").unparsed,
			"one, two",
		);
	});

	it("reads empty text as holding nothing", () => {
		assert.deepEqual(parseAddressInput("   "), { entries: [], unparsed: "" });
	});

	it("ignores the separators an empty slot leaves behind", () => {
		assert.deepEqual(parseAddressInput("ada@example.com,,"), {
			entries: [{ email: "ada@example.com" }],
			unparsed: "",
		});
	});

	it("rejects an address with no top-level domain", () => {
		assert.deepEqual(parseAddressInput("ada@example"), {
			entries: [],
			unparsed: "ada@example",
		});
	});
});
