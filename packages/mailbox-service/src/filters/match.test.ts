import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FilterItem } from "@remit/data-ports";
import { FilterClauseField, FilterMatchOperator } from "@remit/domain-enums";
import { getDomain } from "tldts";
import {
	clauseMatches,
	type FilterMessage,
	literalClausesMatch,
	literalClauseTerms,
	selectMoveWinner,
} from "./match.js";

type FilterClause = FilterItem["literalClauses"][number];

const message = (overrides: Partial<FilterMessage> = {}): FilterMessage => ({
	from: "alice@acme.example",
	fromName: "Alice Example",
	subject: "Q3 invoice attached",
	text: "Please find the invoice for the quarter attached.",
	listId: "",
	...overrides,
});

const clause = (field: FilterClause["field"], value: string): FilterClause => ({
	field,
	value,
});

describe("clauseMatches", () => {
	it("matches From against the sender address, case-insensitively", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.From, "ACME.example"),
				message(),
				getDomain,
			),
			true,
		);
	});

	it("matches From against the sender display name", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.From, "alice example"),
				message(),
				getDomain,
			),
			true,
		);
	});

	it("matches Subject as a substring", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.Subject, "invoice"),
				message(),
				getDomain,
			),
			true,
		);
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.Subject, "receipt"),
				message(),
				getDomain,
			),
			false,
		);
	});

	it("matches HasWords against subject or body", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.HasWords, "quarter"),
				message(),
				getDomain,
			),
			true,
		);
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.HasWords, "Q3"),
				message(),
				getDomain,
			),
			true,
		);
	});

	it("matches HasWords on the sender display name alone, as search does", () => {
		const msg = message({
			from: "booking@mail.example",
			fromName: "Austrian Airlines Booking",
			subject: "Your trip to Vienna",
			text: "Check in opens 24 hours before departure.",
		});
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.HasWords, "Austrian airlines"),
				msg,
				getDomain,
			),
			true,
		);
	});

	it("matches HasWords regardless of word order and case", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.HasWords, "ALICE invoice"),
				message(),
				getDomain,
			),
			true,
		);
	});

	it("does not match HasWords when one word is missing", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.HasWords, "invoice receipt"),
				message(),
				getDomain,
			),
			false,
		);
	});

	it("never matches an empty clause value", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.HasWords, "   "),
				message(),
				getDomain,
			),
			false,
		);
	});

	it("matches ListId exactly, never as a substring", () => {
		const msg = message({ listId: "weekly.news.example.com" });
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.ListId, "weekly.news.example.com"),
				msg,
				getDomain,
			),
			true,
		);
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.ListId, "news.example.com"),
				msg,
				getDomain,
			),
			false,
		);
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.ListId, "weekly.news.example.com.other"),
				msg,
				getDomain,
			),
			false,
		);
	});

	it("normalizes ListId brackets and case on both sides", () => {
		const msg = message({ listId: "weekly.news.example.com" });
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.ListId, "<Weekly.News.Example.COM>"),
				msg,
				getDomain,
			),
			true,
		);
	});

	it("never matches ListId on a message with no List-Id", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.ListId, "weekly.news.example.com"),
				message({ listId: "" }),
				getDomain,
			),
			false,
		);
	});

	it("matches FromDomain on the registrable domain, including subdomains", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.FromDomain, "github.com"),
				message({ from: "notifications@github.com" }),
				getDomain,
			),
			true,
		);
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.FromDomain, "github.com"),
				message({ from: "notifications@sub.github.com" }),
				getDomain,
			),
			true,
		);
	});

	it("never matches FromDomain on a look-alike subdomain (public-suffix aware)", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.FromDomain, "github.com"),
				message({ from: "attacker@github.com.evil.example" }),
				getDomain,
			),
			false,
		);
	});

	it("matches FromDomain across multi-level public suffixes", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.FromDomain, "example.co.uk"),
				message({ from: "hr@mail.example.co.uk" }),
				getDomain,
			),
			true,
		);
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.FromDomain, "example.co.uk"),
				message({ from: "hr@example.co.uk.evil.example" }),
				getDomain,
			),
			false,
		);
	});
});

describe("literalClausesMatch", () => {
	it("matches nothing with no clauses, under either operator", () => {
		for (const operator of [FilterMatchOperator.And, FilterMatchOperator.Or]) {
			assert.equal(
				literalClausesMatch([], operator, message(), getDomain),
				false,
			);
		}
	});

	it("And requires every clause to match", () => {
		const clauses = [
			clause(FilterClauseField.From, "acme.example"),
			clause(FilterClauseField.Subject, "invoice"),
		];
		assert.equal(
			literalClausesMatch(
				clauses,
				FilterMatchOperator.And,
				message(),
				getDomain,
			),
			true,
		);
		assert.equal(
			literalClausesMatch(
				[...clauses, clause(FilterClauseField.Subject, "nope")],
				FilterMatchOperator.And,
				message(),
				getDomain,
			),
			false,
		);
	});

	it("Or requires only one clause to match", () => {
		const clauses = [
			clause(FilterClauseField.Subject, "nope"),
			clause(FilterClauseField.Subject, "invoice"),
		];
		assert.equal(
			literalClausesMatch(
				clauses,
				FilterMatchOperator.Or,
				message(),
				getDomain,
			),
			true,
		);
		assert.equal(
			literalClausesMatch(
				[clause(FilterClauseField.Subject, "nope")],
				FilterMatchOperator.Or,
				message(),
				getDomain,
			),
			false,
		);
	});
});

describe("selectMoveWinner", () => {
	const filter = (
		filterId: string,
		actionChangedAt: number,
		ruleChangedAt = actionChangedAt,
	): FilterItem => ({ filterId, actionChangedAt, ruleChangedAt }) as FilterItem;

	it("returns undefined with no candidates", () => {
		assert.equal(selectMoveWinner([]), undefined);
	});

	it("picks the most-recently action-changed filter", () => {
		const winner = selectMoveWinner([
			filter("a", 100),
			filter("b", 300),
			filter("c", 200),
		]);
		assert.equal(winner?.filterId, "b");
	});

	it("tie-breaks on filterId when actionChangedAt is identical", () => {
		const winner = selectMoveWinner([
			filter("a", 100),
			filter("c", 100),
			filter("b", 100),
		]);
		assert.equal(winner?.filterId, "c");
	});

	it("ignores a ruleChangedAt-only bump — extending scope/expiry alone must not promote a filter to move-winner (reader #384)", () => {
		// filter A's predicate/action last changed at 10:00 (actionChangedAt).
		// filter B was created at 09:00 and never had its predicate/action
		// touched since, but a user extended its expiry at 11:00 — bumping only
		// its ruleChangedAt (RFC 034 Decision 3.2 / #294), not what it matches or
		// does. B must not out-rank A.
		const filterA = filter("filter-a", 10_00);
		const filterB = filter("filter-b", 9_00, 11_00);

		const winner = selectMoveWinner([filterA, filterB]);
		assert.equal(
			winner?.filterId,
			"filter-a",
			"A still wins: its actionChangedAt (10:00) beats B's (09:00), even though B's ruleChangedAt (11:00) is later",
		);
	});
});

describe("literalClauseTerms (reader #459)", () => {
	it("narrows From and Subject onto the columns that carry them", () => {
		assert.deepEqual(
			literalClauseTerms(
				[
					clause(FilterClauseField.From, " alice@acme.example "),
					clause(FilterClauseField.Subject, "invoice"),
				],
				FilterMatchOperator.And,
				getDomain,
			),
			{
				terms: [
					{ field: "sender", contains: "alice@acme.example" },
					{ field: "subject", contains: "invoice" },
				],
				operator: "and",
			},
		);
	});

	it("narrows FromDomain to the registrable domain, which the sender always contains", () => {
		const narrowing = literalClauseTerms(
			[clause(FilterClauseField.FromDomain, "billing@mail.acme.example")],
			FilterMatchOperator.And,
			getDomain,
		);

		assert.deepEqual(narrowing?.terms, [
			{ field: "sender", contains: "acme.example" },
		]);
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.FromDomain, "billing@mail.acme.example"),
				message(),
				getDomain,
			),
			true,
		);
	});

	it("narrows ListId to its canonical form", () => {
		assert.deepEqual(
			literalClauseTerms(
				[clause(FilterClauseField.ListId, "News <Weekly.News.Example.com>")],
				FilterMatchOperator.And,
				getDomain,
			)?.terms,
			[{ field: "listId", contains: "weekly.news.example.com" }],
		);
	});

	it("returns null for clauses nothing can satisfy, so no query is worth running", () => {
		assert.equal(
			literalClauseTerms(
				[clause(FilterClauseField.From, "   ")],
				FilterMatchOperator.And,
				getDomain,
			),
			null,
		);
		assert.equal(
			literalClauseTerms(
				[clause(FilterClauseField.FromDomain, "not a domain")],
				FilterMatchOperator.Or,
				getDomain,
			),
			null,
		);
	});

	it("drops an unsatisfiable clause from an Or instead of losing the rest", () => {
		assert.deepEqual(
			literalClauseTerms(
				[
					clause(FilterClauseField.From, ""),
					clause(FilterClauseField.Subject, "invoice"),
				],
				FilterMatchOperator.Or,
				getDomain,
			),
			{ terms: [{ field: "subject", contains: "invoice" }], operator: "or" },
		);
	});

	it("narrows nothing when an Or reaches a clause no column carries", () => {
		assert.deepEqual(
			literalClauseTerms(
				[
					clause(FilterClauseField.HasWords, "quarter"),
					clause(FilterClauseField.Subject, "invoice"),
				],
				FilterMatchOperator.Or,
				getDomain,
			),
			{ terms: [], operator: "or" },
		);
	});

	it("asks the store for nothing with no clauses, since they match nothing", () => {
		assert.equal(
			literalClauseTerms([], FilterMatchOperator.And, getDomain),
			null,
		);
		assert.equal(
			literalClauseTerms([], FilterMatchOperator.Or, getDomain),
			null,
		);
	});
});
