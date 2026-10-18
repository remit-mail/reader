/**
 * The rule ↔ predicate wiring behind the Organize chip editor (RFC 038 D1). The
 * load-bearing contract lives here: the predicate the editor previews is exactly
 * the predicate a commit applies, so the count on screen is the set that moves.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FilterRule } from "@remit/ui";
import { buildOrganizeInput } from "./organize-model";
import {
	derivePreview,
	isEvaluablePredicate,
	normalizeClauseValue,
	normalizeListId,
	predicateSignature,
	rulePredicate,
	ruleToDraft,
} from "./rule-model";

describe("normalizeListId", () => {
	it("strips the bracketed identifier, trims, and case-folds — matching the backend", () => {
		assert.equal(
			normalizeListId("<Weekly.News.Example.com>"),
			"weekly.news.example.com",
		);
		assert.equal(normalizeListId("  Weekly.News  "), "weekly.news");
		assert.equal(normalizeListId(""), "");
	});

	it("only normalizes the ListId field, trimming the rest", () => {
		assert.equal(
			normalizeClauseValue("ListId", "<List.Example.COM>"),
			"list.example.com",
		);
		assert.equal(normalizeClauseValue("From", "  a@x.com  "), "a@x.com");
		assert.equal(
			normalizeClauseValue("FromDomain", " github.com "),
			"github.com",
		);
	});
});

const rule: FilterRule = {
	clauses: [{ id: "c1", field: "Subject", value: "receipt" }],
	matchOperator: "all",
	moveMailboxId: "mbx-archive",
	scope: "once",
};

describe("rulePredicate", () => {
	it("carries the operator and the literal clauses", () => {
		const predicate = rulePredicate(rule);
		assert.equal(predicate.matchOperator, "And");
		assert.deepEqual(predicate.literalClauses, [
			{ field: "Subject", value: "receipt" },
		]);
	});

	it("maps the any operator to Or", () => {
		const predicate = rulePredicate({ ...rule, matchOperator: "any" });
		assert.equal(predicate.matchOperator, "Or");
	});
});

describe("predicateSignature", () => {
	it("is stable across identical predicates", () => {
		assert.equal(
			predicateSignature(rulePredicate(rule)),
			predicateSignature(rulePredicate(rule)),
		);
	});

	it("changes when a clause value changes", () => {
		const changed: FilterRule = {
			...rule,
			clauses: [{ id: "c1", field: "Subject", value: "invoice" }],
		};
		assert.notEqual(
			predicateSignature(rulePredicate(rule)),
			predicateSignature(rulePredicate(changed)),
		);
	});
});

describe("the previewed set equals the applied set", () => {
	it("carries exactly the previewed predicate into the commit draft", () => {
		const preview = buildOrganizeInput({
			...rulePredicate(rule),
			matchOperator: rulePredicate(rule).matchOperator,
			literalClauses: rulePredicate(rule).literalClauses,
		});
		const apply = buildOrganizeInput(ruleToDraft(rule));
		assert.equal(apply.matchOperator, preview.matchOperator);
		assert.deepEqual(apply.literalClauses, preview.literalClauses);
	});

	it("adds the expiry only for the until scope, never touching the match set", () => {
		const once = ruleToDraft(rule);
		assert.equal(once.expiresAt, undefined);

		const until = ruleToDraft({
			...rule,
			scope: "until",
			until: "2999-01-02",
		});
		assert.ok(until.expiresAt?.startsWith("2999-01-02"));
		assert.deepEqual(until.literalClauses, once.literalClauses);
	});

	it("carries the move destination into the draft", () => {
		assert.equal(ruleToDraft(rule).moveMailboxId, "mbx-archive");
	});

	it("carries the label target into the draft (issue #26)", () => {
		const labeled = { ...rule, labelId: "lbl-receipts" };
		assert.equal(ruleToDraft(labeled).labelId, "lbl-receipts");
	});
});

describe("derivePreview", () => {
	const signature = "sig-current";

	it("is loading before the first count lands", () => {
		assert.deepEqual(derivePreview({}, signature), { status: "loading" });
	});

	it("is ready when the count was counted for the current predicate", () => {
		assert.deepEqual(
			derivePreview({ count: 42, previewedSignature: signature }, signature),
			{ status: "ready", count: 42 },
		);
	});

	it("goes stale — never blank — when the predicate has moved past the count", () => {
		assert.deepEqual(
			derivePreview({ count: 42, previewedSignature: "sig-old" }, signature),
			{ status: "ready", count: 42, stale: true },
		);
	});

	it("surfaces an error raised for the current predicate", () => {
		assert.deepEqual(
			derivePreview(
				{ count: 1, error: "boom", errorSignature: signature },
				signature,
			),
			{ status: "error", reason: "boom" },
		);
	});

	it("ignores an error raised for a predicate already moved past", () => {
		assert.deepEqual(
			derivePreview(
				{
					count: 5,
					previewedSignature: signature,
					error: "boom",
					errorSignature: "sig-old",
				},
				signature,
			),
			{ status: "ready", count: 5 },
		);
	});
});

describe("isEvaluablePredicate", () => {
	it("accepts literal clauses the matcher can read off the thread rows", () => {
		assert.equal(
			isEvaluablePredicate({
				matchOperator: "And",
				literalClauses: [
					{ field: "From", value: "npm@github.com" },
					{ field: "Subject", value: "Invoice" },
				],
			}),
			true,
		);
	});

	it("rejects a body clause — the shape that answered 500", () => {
		assert.equal(
			isEvaluablePredicate({
				matchOperator: "And",
				literalClauses: [{ field: "HasWords", value: "receipt" }],
			}),
			false,
		);
	});

	it("rejects it however it is mixed in with clauses that are evaluable", () => {
		assert.equal(
			isEvaluablePredicate({
				matchOperator: "Or",
				literalClauses: [
					{ field: "From", value: "npm@github.com" },
					{ field: "HasWords", value: "receipt" },
				],
			}),
			false,
		);
	});

	it("accepts an empty predicate", () => {
		assert.equal(
			isEvaluablePredicate({ matchOperator: "And", literalClauses: [] }),
			true,
		);
	});
});
