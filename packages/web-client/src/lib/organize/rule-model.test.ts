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
	buildInitialRule,
	derivePreview,
	normalizeClauseValue,
	normalizeListId,
	predicateSignature,
	rulePredicate,
	ruleToDraft,
	SUPPORTED_CLAUSE_FIELDS,
} from "./rule-model";

describe("SUPPORTED_CLAUSE_FIELDS", () => {
	it("offers every field the backend matcher now evaluates, ListId and FromDomain included (#262)", () => {
		assert.deepEqual(SUPPORTED_CLAUSE_FIELDS, [
			"From",
			"Subject",
			"HasWords",
			"ListId",
			"FromDomain",
		]);
	});
});

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

describe("buildInitialRule", () => {
	it("opens a semantic-capable rule on the widen anchor with no literal clauses", () => {
		const rule = buildInitialRule({
			anchorMessageId: "msg-1",
			semanticUnavailable: false,
			senders: [],
			selectionCount: 3,
		});
		assert.equal(rule.clauses.length, 0);
		assert.deepEqual(rule.widen, { anchorCount: 3 });
		assert.equal(rule.matchOperator, "all");
		assert.equal(rule.scope, "once");
	});

	it("opens the sender fallback on visible, editable derived From chips (#251)", () => {
		const rule = buildInitialRule({
			anchorMessageId: "msg-1",
			semanticUnavailable: true,
			senders: ["a@x.com", "b@y.com"],
			selectionCount: 2,
		});
		assert.equal(rule.widen, undefined);
		assert.equal(rule.matchOperator, "any");
		assert.deepEqual(
			rule.clauses.map((clause) => ({
				field: clause.field,
				value: clause.value,
				derived: clause.derived,
			})),
			[
				{ field: "From", value: "a@x.com", derived: true },
				{ field: "From", value: "b@y.com", derived: true },
			],
		);
	});

	it("collapses senders sharing a registrable domain to one derived FromDomain chip (#262)", () => {
		const rule = buildInitialRule({
			semanticUnavailable: true,
			senders: ["npm@github.com", "ci@sub.github.com"],
			selectionCount: 2,
		});
		assert.equal(rule.matchOperator, "any");
		assert.deepEqual(
			rule.clauses.map((clause) => ({
				field: clause.field,
				value: clause.value,
				derived: clause.derived,
			})),
			[{ field: "FromDomain", value: "github.com", derived: true }],
		);
	});

	it("carries a Something-else seed's folder and scope", () => {
		const rule = buildInitialRule({
			anchorMessageId: "msg-1",
			semanticUnavailable: false,
			senders: [],
			selectionCount: 1,
			seedMailboxId: "mbx-archive",
			seedScope: "standing",
		});
		assert.equal(rule.moveMailboxId, "mbx-archive");
		assert.equal(rule.scope, "standing");
	});

	it("offers no widen when there is no anchor to ride on", () => {
		const rule = buildInitialRule({
			semanticUnavailable: false,
			senders: [],
			selectionCount: 0,
		});
		assert.equal(rule.widen, undefined);
	});
});

const semanticRule: FilterRule = {
	clauses: [{ id: "c1", field: "Subject", value: "receipt" }],
	matchOperator: "all",
	widen: { anchorCount: 2 },
	moveMailboxId: "mbx-archive",
	scope: "once",
};

describe("rulePredicate", () => {
	it("includes the anchor while the widen is present and active", () => {
		const predicate = rulePredicate(semanticRule, "msg-1");
		assert.equal(predicate.anchorMessageId, "msg-1");
		assert.equal(predicate.matchOperator, "And");
		assert.deepEqual(predicate.literalClauses, [
			{ field: "Subject", value: "receipt" },
		]);
	});

	it("drops the anchor once the widen is removed", () => {
		const predicate = rulePredicate(
			{ ...semanticRule, widen: undefined },
			"msg-1",
		);
		assert.equal(predicate.anchorMessageId, undefined);
	});

	it("drops the anchor for a widen the deployment cannot evaluate (D4 inactive)", () => {
		const predicate = rulePredicate(
			{ ...semanticRule, widen: { anchorCount: 2, inactive: true } },
			"msg-1",
		);
		assert.equal(predicate.anchorMessageId, undefined);
	});

	it("maps the any operator to Or", () => {
		const predicate = rulePredicate(
			{ ...semanticRule, matchOperator: "any" },
			"msg-1",
		);
		assert.equal(predicate.matchOperator, "Or");
	});
});

describe("predicateSignature", () => {
	it("is stable across identical predicates", () => {
		assert.equal(
			predicateSignature(rulePredicate(semanticRule, "msg-1")),
			predicateSignature(rulePredicate(semanticRule, "msg-1")),
		);
	});

	it("changes when a clause value changes", () => {
		const changed: FilterRule = {
			...semanticRule,
			clauses: [{ id: "c1", field: "Subject", value: "invoice" }],
		};
		assert.notEqual(
			predicateSignature(rulePredicate(semanticRule, "msg-1")),
			predicateSignature(rulePredicate(changed, "msg-1")),
		);
	});

	it("changes when the widen is removed", () => {
		assert.notEqual(
			predicateSignature(rulePredicate(semanticRule, "msg-1")),
			predicateSignature(
				rulePredicate({ ...semanticRule, widen: undefined }, "msg-1"),
			),
		);
	});
});

describe("the previewed set equals the applied set", () => {
	it("carries exactly the previewed predicate into the commit draft", () => {
		const preview = buildOrganizeInput({
			...rulePredicate(semanticRule, "msg-1"),
			matchOperator: rulePredicate(semanticRule, "msg-1").matchOperator,
			literalClauses: rulePredicate(semanticRule, "msg-1").literalClauses,
		});
		const apply = buildOrganizeInput(ruleToDraft(semanticRule, "msg-1"));
		assert.equal(apply.anchorMessageId, preview.anchorMessageId);
		assert.equal(apply.matchOperator, preview.matchOperator);
		assert.deepEqual(apply.literalClauses, preview.literalClauses);
	});

	it("keeps them equal for the sender fallback (no anchor, Or)", () => {
		const rule = buildInitialRule({
			semanticUnavailable: true,
			senders: ["a@x.com", "b@y.com"],
			selectionCount: 2,
		});
		const predicate = rulePredicate(rule);
		const apply = buildOrganizeInput(ruleToDraft(rule));
		assert.equal(apply.anchorMessageId, undefined);
		assert.equal(apply.matchOperator, "Or");
		assert.deepEqual(apply.literalClauses, predicate.literalClauses);
	});

	it("adds the expiry only for the until scope, never touching the match set", () => {
		const once = ruleToDraft(semanticRule, "msg-1");
		assert.equal(once.expiresAt, undefined);

		const until = ruleToDraft(
			{ ...semanticRule, scope: "until", until: "2999-01-02" },
			"msg-1",
		);
		assert.ok(until.expiresAt?.startsWith("2999-01-02"));
		assert.deepEqual(until.literalClauses, once.literalClauses);
		assert.equal(until.anchorMessageId, once.anchorMessageId);
	});

	it("carries the move destination into the draft", () => {
		assert.equal(
			ruleToDraft(semanticRule, "msg-1").moveMailboxId,
			"mbx-archive",
		);
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
