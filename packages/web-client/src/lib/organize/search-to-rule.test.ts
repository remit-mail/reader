import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isConvertible, makeFilterBlockedCopy } from "@remit/ui";
import { parseSearchTokens, type SearchTokenContext } from "../search-tokens";
import { convertSearchToRule, searchRuleAccountId } from "./search-to-rule";

const CONTEXT: SearchTokenContext = {
	mailboxesByName: new Map([["archive", "mbx-archive"]]),
	accountsByName: new Map([["work", "acc-work"]]),
};

const convert = (
	query: string,
	options: { searchHadSemanticReach?: boolean } = {},
) =>
	convertSearchToRule(parseSearchTokens(query, CONTEXT), {
		searchHadSemanticReach: options.searchHadSemanticReach ?? false,
	});

describe("convertSearchToRule — facet → clause mapping", () => {
	it("maps literal terms to a HasWords clause", () => {
		const conversion = convert("quarterly report");
		assert.deepEqual(conversion.clauses, [
			{ field: "HasWords", value: "quarterly report" },
		]);
		assert.equal(conversion.keptTerms, true);
	});

	it("maps a from: facet to a From clause", () => {
		const conversion = convert("from:alerts@github.com");
		assert.deepEqual(conversion.clauses, [
			{ field: "From", value: "alerts@github.com" },
		]);
		assert.equal(conversion.keptTerms, false);
	});

	it("combines terms and a sender under an all-match operator", () => {
		const conversion = convert("from:alerts@github.com pull request");
		assert.equal(conversion.matchOperator, "all");
		assert.deepEqual(conversion.clauses, [
			{ field: "From", value: "alerts@github.com" },
			{ field: "HasWords", value: "pull request" },
		]);
	});
});

describe("convertSearchToRule — facets with no clause equivalent", () => {
	it("keeps a folder-scoped search OUT of the rule, never silently unscoping it", () => {
		const conversion = convert("in:archive receipts");
		assert.deepEqual(conversion.scopedOut, {
			mailboxId: "mbx-archive",
			label: "archive",
		});
		// The folder never becomes a clause.
		assert.deepEqual(conversion.clauses, [
			{ field: "HasWords", value: "receipts" },
		]);
	});

	it("drops attachment, unread and date facets, naming each", () => {
		const conversion = convert(
			"invoice has:attachment is:unread before:2026-01-01 after:2025-01-01",
		);
		const labels = conversion.droppedFacets.map((facet) => facet.label);
		assert.deepEqual(labels, [
			"Has attachment",
			"Unread",
			"Before 2026-01-01",
			"After 2025-01-01",
		]);
		assert.deepEqual(conversion.clauses, [
			{ field: "HasWords", value: "invoice" },
		]);
	});

	it("targets the account an account: facet names, without a clause for it", () => {
		const conversion = convert("account:work standup");
		assert.equal(conversion.targetAccountId, "acc-work");
		assert.deepEqual(conversion.clauses, [
			{ field: "HasWords", value: "standup" },
		]);
	});
});

describe("convertSearchToRule — semantic honesty (RFC 038 D5)", () => {
	it("states the dropped reach when the search surfaced similar mail", () => {
		// The literal filter cannot reproduce the reach the search just showed.
		const conversion = convert("things like this", {
			searchHadSemanticReach: true,
		});
		assert.equal(conversion.droppedSemantic, true);
		// The literal words are still kept.
		assert.deepEqual(conversion.clauses, [
			{ field: "HasWords", value: "things like this" },
		]);
	});

	it("says nothing when the search had no semantic reach to drop", () => {
		const conversion = convert("things like this", {
			searchHadSemanticReach: false,
		});
		assert.equal(conversion.droppedSemantic, false);
	});

	it("never reports dropped semantics for a facet-only search", () => {
		const conversion = convert("from:a@b.com", {
			searchHadSemanticReach: true,
		});
		assert.equal(conversion.keptTerms, false);
		assert.equal(conversion.droppedSemantic, false);
	});
});

describe("convertSearchToRule — nothing left to make a filter from", () => {
	it("yields no clause for a query of only dropped facets", () => {
		assert.equal(isConvertible(convert("has:attachment")), false);
	});

	it("yields no clause for a bare folder scope", () => {
		assert.equal(isConvertible(convert("in:archive")), false);
	});

	it("yields a clause once a term rides along with the folder scope", () => {
		assert.equal(isConvertible(convert("in:archive receipts")), true);
	});

	// The brief's chips write their terms into the query, so a query can be made
	// entirely of them. What is in the way is then the facets themselves, and the
	// reason names them rather than asking for something that was just supplied.
	it("names the facets a query composed only of chips is made of", () => {
		const conversion = convert("is:unread category:newsletter");
		assert.equal(isConvertible(conversion), false);
		assert.equal(
			makeFilterBlockedCopy(
				conversion.droppedFacets.map((facet) => facet.label),
			),
			"Unread and Category: Newsletter aren't filter conditions — add a sender or words to filter on",
		);
	});
});

describe("searchRuleAccountId — whose account the filter belongs to", () => {
	const ACCOUNTS = [{ accountId: "acc-first" }, { accountId: "acc-work" }];

	it("uses the account the surface is showing for an ordinary search", () => {
		assert.equal(
			searchRuleAccountId(convert("invoice"), "acc-work", ACCOUNTS),
			"acc-work",
		);
	});

	it("lets an account: facet name a different account than the surface", () => {
		assert.equal(
			searchRuleAccountId(
				convert("account:work invoice"),
				"acc-other",
				ACCOUNTS,
			),
			"acc-work",
		);
	});

	it("falls back to the first configured account only when nothing names one", () => {
		assert.equal(
			searchRuleAccountId(convert("invoice"), undefined, ACCOUNTS),
			"acc-first",
		);
	});

	it("has no account to give when none is configured", () => {
		assert.equal(
			searchRuleAccountId(convert("invoice"), undefined, []),
			undefined,
		);
	});
});
