import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildClauseSuggestions,
	CLAUSE_SUGGESTION_LIMIT,
	fieldTakesAddressSuggestions,
	type KnownAddress,
} from "./clause-suggestions";

const selection: KnownAddress[] = [
	{ email: "receipts@stripe.com", displayName: "Stripe", fromSelection: true },
	{ email: "rides@lyft.com", fromSelection: true },
];

describe("fieldTakesAddressSuggestions", () => {
	it("offers values for the address fields only", () => {
		assert.equal(fieldTakesAddressSuggestions("From"), true);
		assert.equal(fieldTakesAddressSuggestions("FromDomain"), true);
		assert.equal(fieldTakesAddressSuggestions("Subject"), false);
		assert.equal(fieldTakesAddressSuggestions("HasWords"), false);
		assert.equal(fieldTakesAddressSuggestions("ListId"), false);
	});
});

describe("buildClauseSuggestions", () => {
	it("offers the selection's addresses before anything is typed", () => {
		const suggestions = buildClauseSuggestions("From", "", selection);
		assert.deepEqual(
			suggestions.map((s) => s.value),
			["receipts@stripe.com", "rides@lyft.com"],
		);
		assert.equal(suggestions[0].label, "Stripe");
		assert.equal(suggestions[0].hint, "receipts@stripe.com");
		assert.equal(suggestions[0].source, "selected");
	});

	it("leaves a free-text field with nothing to offer", () => {
		assert.deepEqual(buildClauseSuggestions("Subject", "", selection), []);
		assert.deepEqual(buildClauseSuggestions("HasWords", "str", selection), []);
	});

	it("collapses an address to its registrable domain for a domain clause", () => {
		const suggestions = buildClauseSuggestions("FromDomain", "", [
			{ email: "receipts@mail.stripe.com" },
			{ email: "invoices@stripe.com" },
			{ email: "rides@lyft.co.uk" },
			{ email: "news@mail.bbc.co.uk" },
		]);
		assert.deepEqual(
			suggestions.map((s) => s.value),
			["stripe.com", "lyft.co.uk", "bbc.co.uk"],
		);
	});

	it("drops an address it cannot resolve a domain for", () => {
		assert.deepEqual(
			buildClauseSuggestions("FromDomain", "", [{ email: "postmaster" }]),
			[],
		);
	});

	it("matches on the typed text, against the address and the display name", () => {
		assert.deepEqual(
			buildClauseSuggestions("From", "stri", selection).map((s) => s.value),
			["receipts@stripe.com"],
		);
		assert.deepEqual(
			buildClauseSuggestions("From", "LYFT", selection).map((s) => s.value),
			["rides@lyft.com"],
		);
	});

	it("offers nothing when the typed value matches none of them", () => {
		assert.deepEqual(buildClauseSuggestions("From", "nobody", selection), []);
	});

	it("drops an offer the user has already typed in full", () => {
		assert.deepEqual(
			buildClauseSuggestions("From", " Receipts@Stripe.com ", selection).map(
				(s) => s.value,
			),
			[],
		);
	});

	it("keeps the first occurrence of a repeated value, marking and all", () => {
		const suggestions = buildClauseSuggestions("From", "", [
			...selection,
			{ email: "Receipts@stripe.com", displayName: "Stripe Billing" },
		]);
		assert.equal(suggestions.length, 2);
		assert.equal(suggestions[0].source, "selected");
		assert.equal(suggestions[0].label, "Stripe");
	});

	it("skips a blank address", () => {
		assert.deepEqual(
			buildClauseSuggestions("From", "", [{ email: "  " }, ...selection]).map(
				(s) => s.value,
			),
			["receipts@stripe.com", "rides@lyft.com"],
		);
	});

	it("caps the list so it stays a shortcut rather than a directory", () => {
		const many: KnownAddress[] = Array.from({ length: 20 }, (_, index) => ({
			email: `sender-${index}@example.com`,
		}));
		assert.equal(
			buildClauseSuggestions("From", "", many).length,
			CLAUSE_SUGGESTION_LIMIT,
		);
	});
});
