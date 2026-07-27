import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	activeSearchTerm,
	applySearchSuggestion,
	buildSearchSuggestions,
	contactSuggestionValue,
	SEARCH_SUGGESTION_LIMIT,
	type SearchSuggestionData,
	searchSuggestionRequest,
} from "./search-suggestions.js";
import { parseSearchTokens } from "./search-tokens.js";

const DATA: SearchSuggestionData = {
	mailboxes: [{ value: "Archive" }, { value: "Sent Items" }],
	accounts: [{ value: "work" }, { value: "personal" }],
	contacts: [
		{
			value: "alice@example.com",
			label: "Alice Adams",
			hint: "alice@example.com",
		},
		{ value: "bob@example.com" },
	],
};

const values = (suggestions: readonly { value: string }[]): string[] =>
	suggestions.map((s) => s.value);

describe("activeSearchTerm", () => {
	it("finds the term the caret sits in", () => {
		const term = activeSearchTerm("invoice from:ali", 16);
		assert.equal(term.raw, "from:ali");
		assert.equal(term.start, 8);
		assert.equal(term.end, 16);
		assert.equal(term.name, "from");
		assert.equal(term.value, "ali");
	});

	it("has no token name for a bare word", () => {
		const term = activeSearchTerm("invoice", 4);
		assert.equal(term.name, undefined);
		assert.equal(term.raw, "invoice");
	});

	it("is an empty term at the caret when the caret is on whitespace", () => {
		const term = activeSearchTerm("invoice ", 8);
		assert.deepEqual(term, { start: 8, end: 8, raw: "" });
	});

	it("reads through a quoted value", () => {
		const term = activeSearchTerm('in:"Sent It', 11);
		assert.equal(term.name, "in");
		assert.equal(term.value, "Sent It");
	});

	it("clamps a caret past the end of the query", () => {
		assert.equal(activeSearchTerm("is:read", 99).name, "is");
	});
});

describe("searchSuggestionRequest", () => {
	it("asks for token names while a bare word is typed", () => {
		assert.deepEqual(searchSuggestionRequest("inv", 3), {
			kind: "token",
			query: "inv",
		});
	});

	it("names the lookup a committed token needs", () => {
		assert.deepEqual(searchSuggestionRequest("from:ali", 8), {
			kind: "value",
			token: "from",
			source: "contact",
			query: "ali",
		});
		assert.deepEqual(searchSuggestionRequest("in:", 3), {
			kind: "value",
			token: "in",
			source: "mailbox",
			query: "",
		});
	});

	it("asks for nothing on an unknown token", () => {
		assert.equal(searchSuggestionRequest("label:urgent", 12), undefined);
	});
});

describe("buildSearchSuggestions", () => {
	it("offers the vocabulary on an empty query", () => {
		const suggestions = buildSearchSuggestions("", 0);
		assert.deepEqual(values(suggestions), [
			"from:",
			"subject:",
			"category:",
			"is:",
			"has:",
			"in:",
			"account:",
			"after:",
			"before:",
		]);
	});

	it("matches a bare word against token names", () => {
		const suggestions = buildSearchSuggestions("cat", 3);
		assert.ok(values(suggestions).includes("category:"));
		assert.ok(values(suggestions).includes("category:personal"));
	});

	it("reaches a fixed value by the word the user knows", () => {
		const suggestions = buildSearchSuggestions("unr", 3);
		assert.equal(suggestions[0]?.value, "is:unread");
		assert.equal(suggestions[0]?.label, "Unread");
	});

	it("offers a token's fixed values once its name is committed", () => {
		const suggestions = buildSearchSuggestions("is:", 3);
		assert.deepEqual(values(suggestions), [
			"is:unread",
			"is:read",
			"is:starred",
		]);
	});

	it("narrows fixed values against what has been typed", () => {
		assert.deepEqual(values(buildSearchSuggestions("category:mar", 12)), [
			"category:marketing",
		]);
	});

	it("offers the mailboxes it was given for in:, quoted where needed", () => {
		assert.deepEqual(values(buildSearchSuggestions("in:", 3, DATA)), [
			"in:Archive",
			'in:"Sent Items"',
		]);
	});

	it("offers the accounts it was given for account:", () => {
		assert.deepEqual(values(buildSearchSuggestions("account:wo", 10, DATA)), [
			"account:work",
		]);
	});

	it("offers contacts for from:, reading as the display name", () => {
		const suggestions = buildSearchSuggestions("from:ali", 8, DATA);
		assert.deepEqual(values(suggestions), ["from:alice@example.com"]);
		assert.equal(suggestions[0]?.label, "Alice Adams");
		assert.equal(suggestions[0]?.hint, "alice@example.com");
	});

	it("offers nothing for a token whose values are typed, not chosen", () => {
		assert.deepEqual(buildSearchSuggestions("after:2024", 10, DATA), []);
		assert.deepEqual(buildSearchSuggestions("subject:tax", 11, DATA), []);
	});

	it("offers nothing for an unknown token", () => {
		assert.deepEqual(buildSearchSuggestions("label:urgent", 12, DATA), []);
	});

	it("leads with prefix matches", () => {
		const suggestions = buildSearchSuggestions("account:per", 11, DATA);
		assert.deepEqual(values(suggestions), ["account:personal"]);
	});

	it("caps the list", () => {
		const mailboxes = Array.from({ length: 20 }, (_, i) => ({
			value: `Folder${i}`,
		}));
		const suggestions = buildSearchSuggestions("in:", 3, { mailboxes });
		assert.equal(suggestions.length, SEARCH_SUGGESTION_LIMIT);
	});

	it("completes the term the caret is in, not the last one", () => {
		const suggestions = buildSearchSuggestions("is: from:bob", 3);
		assert.deepEqual(values(suggestions), [
			"is:unread",
			"is:read",
			"is:starred",
		]);
	});

	it("offers terms that parse back to the token they came from", () => {
		const suggestions = buildSearchSuggestions("in:", 3, DATA);
		for (const suggestion of suggestions) {
			const { tokens } = parseSearchTokens(suggestion.value, {
				mailboxesByName: new Map([
					["archive", "mailbox-1"],
					["sent items", "mailbox-2"],
				]),
			});
			assert.equal(tokens.length, 1, `${suggestion.value} did not parse`);
		}
	});
});

describe("applySearchSuggestion", () => {
	it("replaces the term and leaves the caret past a completed token", () => {
		const result = applySearchSuggestion("is:unr", 6, { value: "is:unread" });
		assert.deepEqual(result, { query: "is:unread ", cursor: 10 });
	});

	it("keeps the caret on the value of a bare token name", () => {
		const result = applySearchSuggestion("ca", 2, { value: "category:" });
		assert.deepEqual(result, { query: "category:", cursor: 9 });
	});

	it("does not double the space before the next term", () => {
		const result = applySearchSuggestion("is:unr tax", 6, {
			value: "is:unread",
		});
		assert.deepEqual(result, { query: "is:unread tax", cursor: 10 });
	});

	it("leaves the rest of the query alone", () => {
		const result = applySearchSuggestion("invoice in:arch", 15, {
			value: 'in:"Sent Items"',
		});
		assert.equal(result.query, 'invoice in:"Sent Items" ');
	});

	it("inserts at the caret when there is no term there", () => {
		const result = applySearchSuggestion("invoice ", 8, { value: "is:unread" });
		assert.deepEqual(result, { query: "invoice is:unread ", cursor: 18 });
	});
});

describe("contactSuggestionValue", () => {
	it("reads as the display name over the address", () => {
		assert.deepEqual(
			contactSuggestionValue({
				normalizedEmail: "alice@example.com",
				displayName: "Alice Adams",
			}),
			{
				value: "alice@example.com",
				label: "Alice Adams",
				hint: "alice@example.com",
			},
		);
	});

	it("is just the address when there is no display name", () => {
		assert.deepEqual(contactSuggestionValue({ normalizedEmail: "b@ex.com" }), {
			value: "b@ex.com",
		});
	});
});
