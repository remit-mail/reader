import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FilterItem } from "@remit/data-ports";
import { FilterClauseField, FilterMatchOperator } from "@remit/domain-enums";
import {
	buildMatchText,
	clauseMatches,
	cosineSimilarity,
	type FilterMessage,
	literalClausesMatch,
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
			clauseMatches(clause(FilterClauseField.From, "ACME.example"), message()),
			true,
		);
	});

	it("matches From against the sender display name", () => {
		assert.equal(
			clauseMatches(clause(FilterClauseField.From, "alice example"), message()),
			true,
		);
	});

	it("matches Subject as a substring", () => {
		assert.equal(
			clauseMatches(clause(FilterClauseField.Subject, "invoice"), message()),
			true,
		);
		assert.equal(
			clauseMatches(clause(FilterClauseField.Subject, "receipt"), message()),
			false,
		);
	});

	it("matches HasWords against subject or body", () => {
		assert.equal(
			clauseMatches(clause(FilterClauseField.HasWords, "quarter"), message()),
			true,
		);
		assert.equal(
			clauseMatches(clause(FilterClauseField.HasWords, "Q3"), message()),
			true,
		);
	});

	it("never matches an empty clause value", () => {
		assert.equal(
			clauseMatches(clause(FilterClauseField.HasWords, "   "), message()),
			false,
		);
	});

	it("matches ListId exactly, never as a substring", () => {
		const msg = message({ listId: "weekly.news.example.com" });
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.ListId, "weekly.news.example.com"),
				msg,
			),
			true,
		);
		assert.equal(
			clauseMatches(clause(FilterClauseField.ListId, "news.example.com"), msg),
			false,
		);
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.ListId, "weekly.news.example.com.other"),
				msg,
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
			),
			true,
		);
	});

	it("never matches ListId on a message with no List-Id", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.ListId, "weekly.news.example.com"),
				message({ listId: "" }),
			),
			false,
		);
	});

	it("matches FromDomain on the registrable domain, including subdomains", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.FromDomain, "github.com"),
				message({ from: "notifications@github.com" }),
			),
			true,
		);
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.FromDomain, "github.com"),
				message({ from: "notifications@sub.github.com" }),
			),
			true,
		);
	});

	it("never matches FromDomain on a look-alike subdomain (public-suffix aware)", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.FromDomain, "github.com"),
				message({ from: "attacker@github.com.evil.example" }),
			),
			false,
		);
	});

	it("matches FromDomain across multi-level public suffixes", () => {
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.FromDomain, "example.co.uk"),
				message({ from: "hr@mail.example.co.uk" }),
			),
			true,
		);
		assert.equal(
			clauseMatches(
				clause(FilterClauseField.FromDomain, "example.co.uk"),
				message({ from: "hr@example.co.uk.evil.example" }),
			),
			false,
		);
	});
});

describe("literalClausesMatch", () => {
	it("passes vacuously with no clauses (a purely-semantic filter)", () => {
		assert.equal(
			literalClausesMatch([], FilterMatchOperator.And, message()),
			true,
		);
	});

	it("And requires every clause to match", () => {
		const clauses = [
			clause(FilterClauseField.From, "acme.example"),
			clause(FilterClauseField.Subject, "invoice"),
		];
		assert.equal(
			literalClausesMatch(clauses, FilterMatchOperator.And, message()),
			true,
		);
		assert.equal(
			literalClausesMatch(
				[...clauses, clause(FilterClauseField.Subject, "nope")],
				FilterMatchOperator.And,
				message(),
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
			literalClausesMatch(clauses, FilterMatchOperator.Or, message()),
			true,
		);
		assert.equal(
			literalClausesMatch(
				[clause(FilterClauseField.Subject, "nope")],
				FilterMatchOperator.Or,
				message(),
			),
			false,
		);
	});
});

describe("cosineSimilarity", () => {
	it("scores identical vectors as 1", () => {
		assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
	});

	it("scores orthogonal vectors as 0", () => {
		assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
	});

	it("scores a zero vector as 0 rather than dividing by zero", () => {
		assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
	});

	it("throws on a dimension mismatch instead of scoring incomparable vectors", () => {
		assert.throws(
			() => cosineSimilarity([1, 2], [1, 2, 3]),
			/dimension mismatch/,
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

describe("buildMatchText", () => {
	it("joins subject and body and bounds the length", () => {
		const text = buildMatchText(message({ subject: "hello", text: "world" }));
		assert.equal(text, "hello\nworld");
	});

	it("caps at 512 characters", () => {
		const text = buildMatchText(
			message({ subject: "", text: "x".repeat(1000) }),
		);
		assert.equal(text.length, 512);
	});
});
