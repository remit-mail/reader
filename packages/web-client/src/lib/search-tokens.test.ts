import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	parseSearchTokens,
	quoteSearchTokenValue,
	removeSearchToken,
	SEARCH_TOKEN_SPECS,
	type SearchToken,
	searchTokenLabel,
	searchTokenSpec,
	splitSearchTerm,
	splitSearchWords,
} from "./search-tokens.js";

describe("parseSearchTokens", () => {
	it("returns the query untouched when there are no tokens", () => {
		const result = parseSearchTokens("parcel delivery confirmation");
		assert.equal(result.freeText, "parcel delivery confirmation");
		assert.deepEqual(result.tokens, []);
	});

	it("parses from:", () => {
		const result = parseSearchTokens("invoice from:alice@example.com");
		assert.equal(result.freeText, "invoice");
		assert.deepEqual(result.tokens, [
			{
				type: "from",
				raw: "from:alice@example.com",
				value: "alice@example.com",
			},
		]);
	});

	it("parses subject:", () => {
		const result = parseSearchTokens("subject:invoice tax");
		assert.equal(result.freeText, "tax");
		assert.deepEqual(result.tokens, [
			{ type: "subject", raw: "subject:invoice", value: "invoice" },
		]);
	});

	it("parses has:attachment", () => {
		const result = parseSearchTokens("receipts has:attachment");
		assert.equal(result.freeText, "receipts");
		assert.deepEqual(result.tokens, [
			{ type: "hasAttachment", raw: "has:attachment" },
		]);
	});

	it("leaves an unknown has: value as free text", () => {
		const result = parseSearchTokens("has:pictures receipts");
		assert.equal(result.freeText, "has:pictures receipts");
		assert.deepEqual(result.tokens, []);
	});

	it("parses is:unread case-insensitively", () => {
		const result = parseSearchTokens("IS:UNREAD receipts");
		assert.equal(result.freeText, "receipts");
		assert.deepEqual(result.tokens, [{ type: "isUnread", raw: "IS:UNREAD" }]);
	});

	it("parses is:read as its own state, not the absence of unread", () => {
		const result = parseSearchTokens("is:read receipts");
		assert.equal(result.freeText, "receipts");
		assert.deepEqual(result.tokens, [{ type: "isRead", raw: "is:read" }]);
	});

	it("parses is:starred and its is:flagged wire spelling alike", () => {
		assert.deepEqual(parseSearchTokens("is:starred").tokens, [
			{ type: "isStarred", raw: "is:starred" },
		]);
		assert.deepEqual(parseSearchTokens("is:flagged").tokens, [
			{ type: "isStarred", raw: "is:flagged" },
		]);
	});

	it("leaves an unknown is: value as free text", () => {
		const result = parseSearchTokens("is:important receipts");
		assert.equal(result.freeText, "is:important receipts");
		assert.deepEqual(result.tokens, []);
	});

	it("parses category: against the message-category vocabulary", () => {
		const result = parseSearchTokens("category:Personal invoice");
		assert.equal(result.freeText, "invoice");
		assert.deepEqual(result.tokens, [
			{
				type: "category",
				raw: "category:Personal",
				value: "Personal",
				category: "personal",
			},
		]);
	});

	it("accepts the label the chips show for the pending category", () => {
		const result = parseSearchTokens("category:unclassified");
		assert.deepEqual(result.tokens, [
			{
				type: "category",
				raw: "category:unclassified",
				value: "unclassified",
				category: "uncategorized",
			},
		]);
	});

	it("leaves an unknown category as free text", () => {
		const result = parseSearchTokens("category:urgent invoice");
		assert.equal(result.freeText, "category:urgent invoice");
		assert.deepEqual(result.tokens, []);
	});

	it("parses before: and after: as epoch seconds", () => {
		const result = parseSearchTokens("after:2024-01-01 before:2024-02-01 tax");
		assert.equal(result.freeText, "tax");
		assert.deepEqual(result.tokens, [
			{
				type: "after",
				raw: "after:2024-01-01",
				value: "2024-01-01",
				epochSeconds: Date.parse("2024-01-01T00:00:00Z") / 1000,
			},
			{
				type: "before",
				raw: "before:2024-02-01",
				value: "2024-02-01",
				epochSeconds: Date.parse("2024-02-01T00:00:00Z") / 1000,
			},
		]);
	});

	it("leaves a malformed date token in the free text", () => {
		const result = parseSearchTokens("before:not-a-date tax");
		assert.equal(result.freeText, "before:not-a-date tax");
		assert.deepEqual(result.tokens, []);
	});

	it("leaves in:/account: as free text with no name index", () => {
		const result = parseSearchTokens("in:archive account:work invoice");
		assert.equal(result.freeText, "in:archive account:work invoice");
		assert.deepEqual(result.tokens, []);
	});

	it("resolves in: against a supplied mailbox name index", () => {
		const result = parseSearchTokens("in:archive invoice", {
			mailboxesByName: new Map([["archive", "mailbox-1"]]),
		});
		assert.equal(result.freeText, "invoice");
		assert.deepEqual(result.tokens, [
			{
				type: "in",
				raw: "in:archive",
				value: "archive",
				mailboxId: "mailbox-1",
			},
		]);
	});

	it("resolves in: case-insensitively", () => {
		const result = parseSearchTokens("IN:Archive invoice", {
			mailboxesByName: new Map([["archive", "mailbox-1"]]),
		});
		assert.deepEqual(result.tokens, [
			{
				type: "in",
				raw: "IN:Archive",
				value: "Archive",
				mailboxId: "mailbox-1",
			},
		]);
	});

	it("leaves in: as free text when the name isn't in the index", () => {
		const result = parseSearchTokens("in:nonexistent invoice", {
			mailboxesByName: new Map([["archive", "mailbox-1"]]),
		});
		assert.equal(result.freeText, "in:nonexistent invoice");
		assert.deepEqual(result.tokens, []);
	});

	it("resolves account: against a supplied account name index", () => {
		const result = parseSearchTokens("account:work invoice", {
			accountsByName: new Map([["work", "account-1"]]),
		});
		assert.equal(result.freeText, "invoice");
		assert.deepEqual(result.tokens, [
			{
				type: "account",
				raw: "account:work",
				value: "work",
				accountId: "account-1",
			},
		]);
	});

	it("leaves account: as free text when the name isn't in the index", () => {
		const result = parseSearchTokens("account:nonexistent invoice", {
			accountsByName: new Map([["work", "account-1"]]),
		});
		assert.equal(result.freeText, "account:nonexistent invoice");
		assert.deepEqual(result.tokens, []);
	});

	it("parses multiple tokens alongside free text", () => {
		const result = parseSearchTokens(
			"parcel from:dhl.com has:attachment is:unread",
		);
		assert.equal(result.freeText, "parcel");
		assert.equal(result.tokens.length, 3);
	});

	it("ignores a bare 'from:' with no value", () => {
		const result = parseSearchTokens("from:");
		assert.equal(result.freeText, "from:");
		assert.deepEqual(result.tokens, []);
	});

	it("leaves an unknown token as free text rather than erroring", () => {
		const result = parseSearchTokens("label:urgent to:bob invoice");
		assert.equal(result.freeText, "label:urgent to:bob invoice");
		assert.deepEqual(result.tokens, []);
	});

	it("takes a quoted value as one term", () => {
		const result = parseSearchTokens('in:"Sent Items" invoice', {
			mailboxesByName: new Map([["sent items", "mailbox-2"]]),
		});
		assert.equal(result.freeText, "invoice");
		assert.deepEqual(result.tokens, [
			{
				type: "in",
				raw: 'in:"Sent Items"',
				value: "Sent Items",
				mailboxId: "mailbox-2",
			},
		]);
	});

	it("reads an unterminated quote to the end, so a half-typed value still parses", () => {
		const result = parseSearchTokens('subject:"quarterly report');
		assert.deepEqual(result.tokens, [
			{
				type: "subject",
				raw: 'subject:"quarterly report',
				value: "quarterly report",
			},
		]);
	});

	it("keeps quoted free text as it was typed", () => {
		const result = parseSearchTokens('"exact phrase" is:unread');
		assert.equal(result.freeText, '"exact phrase"');
		assert.equal(result.tokens.length, 1);
	});
});

describe("splitSearchWords", () => {
	it("reports where each term sits in the query", () => {
		assert.deepEqual(splitSearchWords("a  bc"), [
			{ raw: "a", start: 0, end: 1 },
			{ raw: "bc", start: 3, end: 5 },
		]);
	});

	it("keeps a quoted run together", () => {
		assert.deepEqual(splitSearchWords('in:"Sent Items" x'), [
			{ raw: 'in:"Sent Items"', start: 0, end: 15 },
			{ raw: "x", start: 16, end: 17 },
		]);
	});

	it("has no terms in an empty query", () => {
		assert.deepEqual(splitSearchWords("   "), []);
	});
});

describe("splitSearchTerm", () => {
	it("splits at the first colon and lower-cases the name", () => {
		assert.deepEqual(splitSearchTerm("From:a:b"), {
			name: "from",
			value: "a:b",
			rawValue: "a:b",
		});
	});

	it("unquotes the value", () => {
		assert.deepEqual(splitSearchTerm('in:"Sent Items"'), {
			name: "in",
			value: "Sent Items",
			rawValue: '"Sent Items"',
		});
	});

	it("is not a token attempt without a name before the colon", () => {
		assert.equal(splitSearchTerm("invoice"), undefined);
		assert.equal(splitSearchTerm(":30"), undefined);
	});
});

describe("quoteSearchTokenValue", () => {
	it("quotes a value with whitespace and leaves a bare one alone", () => {
		assert.equal(quoteSearchTokenValue("Sent Items"), '"Sent Items"');
		assert.equal(quoteSearchTokenValue("Archive"), "Archive");
	});

	it("round-trips through the parser", () => {
		const query = `in:${quoteSearchTokenValue("Sent Items")}`;
		const result = parseSearchTokens(query, {
			mailboxesByName: new Map([["sent items", "mailbox-2"]]),
		});
		assert.equal(result.tokens.length, 1);
		assert.equal(result.freeText, "");
	});
});

describe("SEARCH_TOKEN_SPECS", () => {
	it("carries a spec for every name the parser accepts", () => {
		for (const spec of SEARCH_TOKEN_SPECS) {
			assert.equal(searchTokenSpec(spec.name)?.name, spec.name);
		}
	});

	it("offers only values that parse to a token", () => {
		for (const spec of SEARCH_TOKEN_SPECS) {
			for (const option of spec.options ?? []) {
				const { tokens } = parseSearchTokens(`${spec.name}:${option.value}`);
				assert.equal(
					tokens.length,
					1,
					`${spec.name}:${option.value} did not parse`,
				);
			}
		}
	});

	it("names every category the API carries", () => {
		const category = SEARCH_TOKEN_SPECS.find((s) => s.name === "category");
		assert.deepEqual(category?.options?.map((o) => o.value).sort(), [
			"automated",
			"marketing",
			"newsletter",
			"personal",
			"social",
			"transactional",
			"uncategorized",
		]);
	});
});

describe("removeSearchToken", () => {
	it("removes the token's raw text and collapses whitespace", () => {
		const tokens = parseSearchTokens("parcel from:dhl.com delivery").tokens;
		const next = removeSearchToken(
			"parcel from:dhl.com delivery",
			tokens[0] as NonNullable<(typeof tokens)[0]>,
		);
		assert.equal(next, "parcel delivery");
	});

	it("removes a quoted token whole", () => {
		const query = 'invoice in:"Sent Items" tax';
		const token: SearchToken = {
			type: "in",
			raw: 'in:"Sent Items"',
			value: "Sent Items",
			mailboxId: "mailbox-2",
		};
		assert.equal(removeSearchToken(query, token), "invoice tax");
	});

	it("is a no-op when the token isn't present", () => {
		const next = removeSearchToken("parcel delivery", {
			type: "hasAttachment",
			raw: "has:attachment",
		});
		assert.equal(next, "parcel delivery");
	});
});

describe("searchTokenLabel", () => {
	it("labels each token type in plain words", () => {
		assert.equal(
			searchTokenLabel({ type: "from", raw: "from:alice", value: "alice" }),
			"From: alice",
		);
		assert.equal(
			searchTokenLabel({
				type: "subject",
				raw: "subject:invoice",
				value: "invoice",
			}),
			"Subject: invoice",
		);
		assert.equal(
			searchTokenLabel({
				type: "category",
				raw: "category:uncategorized",
				value: "uncategorized",
				category: "uncategorized",
			}),
			"Category: Unclassified",
		);
		assert.equal(
			searchTokenLabel({ type: "hasAttachment", raw: "has:attachment" }),
			"Has attachment",
		);
		assert.equal(
			searchTokenLabel({ type: "isUnread", raw: "is:unread" }),
			"Unread",
		);
		assert.equal(searchTokenLabel({ type: "isRead", raw: "is:read" }), "Read");
		assert.equal(
			searchTokenLabel({ type: "isStarred", raw: "is:starred" }),
			"Starred",
		);
		assert.equal(
			searchTokenLabel({
				type: "before",
				raw: "before:2024-01-01",
				value: "2024-01-01",
				epochSeconds: 0,
			}),
			"Before 2024-01-01",
		);
		assert.equal(
			searchTokenLabel({
				type: "after",
				raw: "after:2024-01-01",
				value: "2024-01-01",
				epochSeconds: 0,
			}),
			"After 2024-01-01",
		);
		assert.equal(
			searchTokenLabel({
				type: "in",
				raw: "in:archive",
				value: "archive",
				mailboxId: "mailbox-1",
			}),
			"In: archive",
		);
		assert.equal(
			searchTokenLabel({
				type: "account",
				raw: "account:work",
				value: "work",
				accountId: "account-1",
			}),
			"Account: work",
		);
	});
});
