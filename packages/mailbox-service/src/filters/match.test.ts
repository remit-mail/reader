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
	const filter = (filterId: string, ruleChangedAt: number): FilterItem =>
		({ filterId, ruleChangedAt }) as FilterItem;

	it("returns undefined with no candidates", () => {
		assert.equal(selectMoveWinner([]), undefined);
	});

	it("picks the most-recently-changed filter", () => {
		const winner = selectMoveWinner([
			filter("a", 100),
			filter("b", 300),
			filter("c", 200),
		]);
		assert.equal(winner?.filterId, "b");
	});

	it("tie-breaks on filterId when ruleChangedAt is identical", () => {
		const winner = selectMoveWinner([
			filter("a", 100),
			filter("c", 100),
			filter("b", 100),
		]);
		assert.equal(winner?.filterId, "c");
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
