import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import type { FilterRule } from "@remit/ui";
import {
	buildUpdateFilterInput,
	expiresAtToPickedDate,
	filterToRule,
	ruleChangesPredicateOrAction,
} from "./filter-edit-model";

const filter = (
	overrides: Partial<RemitImapFilterResponse> = {},
): RemitImapFilterResponse => ({
	filterId: "f-1",
	accountConfigId: "acc-1",
	name: "Receipts",
	scope: "Standing",
	state: "Active",
	hasAnchor: false,
	ruleChangedAt: 0,
	matchOperator: "And",
	literalClauses: [{ field: "From", value: "receipts@stripe.com" }],
	actionLabelId: "None",
	actionMailboxId: "mbx-receipts",
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

describe("filterToRule", () => {
	it("loads the persisted predicate, action and name unchanged", () => {
		const rule = filterToRule(
			filter({
				matchOperator: "Or",
				literalClauses: [
					{ field: "From", value: "a@x.com" },
					{ field: "Subject", value: "invoice" },
				],
			}),
		);
		assert.equal(rule.matchOperator, "any");
		assert.equal(rule.name, "Receipts");
		assert.equal(rule.moveMailboxId, "mbx-receipts");
		assert.equal(rule.scope, "standing");
		assert.deepEqual(
			rule.clauses.map((clause) => [clause.field, clause.value]),
			[
				["From", "a@x.com"],
				["Subject", "invoice"],
			],
		);
	});

	it("maps the None move sentinel to no action", () => {
		const rule = filterToRule(filter({ actionMailboxId: "None" }));
		assert.equal(rule.moveMailboxId, undefined);
	});

	it("loads a Temporary filter as an until-a-date rule", () => {
		const rule = filterToRule(
			filter({ scope: "Temporary", expiresAt: "2027-03-04T23:59:59+00:00" }),
		);
		assert.equal(rule.scope, "until");
		assert.match(rule.until ?? "", /^\d{4}-\d{2}-\d{2}$/);
	});

	it("shows a semantic anchor as an active widen chip when the deployment can serve it", () => {
		const rule = filterToRule(filter({ hasAnchor: true }));
		assert.ok(rule.widen);
		assert.equal(rule.widen?.inactive, undefined);
	});

	it("marks the widen inactive on a deployment that cannot evaluate it (D4)", () => {
		const rule = filterToRule(filter({ hasAnchor: true }), true);
		assert.equal(rule.widen?.inactive, true);
	});

	it("carries no widen when the filter has no anchor", () => {
		assert.equal(filterToRule(filter({ hasAnchor: false })).widen, undefined);
	});
});

describe("expiresAtToPickedDate", () => {
	it("returns empty for absent or unparseable input", () => {
		assert.equal(expiresAtToPickedDate(undefined), "");
		assert.equal(expiresAtToPickedDate("not-a-date"), "");
	});

	it("reads the local calendar day", () => {
		assert.match(
			expiresAtToPickedDate("2027-03-04T12:00:00Z"),
			/^2027-03-0[45]$/,
		);
	});
});

describe("ruleChangesPredicateOrAction", () => {
	const base = filterToRule(filter({ hasAnchor: true }));

	it("is false for an identical rule and for a rename only", () => {
		assert.equal(ruleChangesPredicateOrAction(base, base), false);
		assert.equal(
			ruleChangesPredicateOrAction({ ...base, name: "New name" }, base),
			false,
		);
	});

	it("is true when a clause, operator, move target or widen changes", () => {
		assert.equal(
			ruleChangesPredicateOrAction({ ...base, matchOperator: "any" }, base),
			true,
		);
		assert.equal(
			ruleChangesPredicateOrAction(
				{ ...base, moveMailboxId: "mbx-other" },
				base,
			),
			true,
		);
		assert.equal(
			ruleChangesPredicateOrAction({ ...base, widen: undefined }, base),
			true,
		);
		assert.equal(
			ruleChangesPredicateOrAction(
				{ ...base, clauses: [{ id: "c", field: "Subject", value: "x" }] },
				base,
			),
			true,
		);
	});
});

describe("buildUpdateFilterInput", () => {
	const original = filterToRule(filter());

	it("sends only the name for a cosmetic rename — no predicate fields", () => {
		const body = buildUpdateFilterInput(
			{ ...original, name: "Invoices" },
			original,
		);
		assert.deepEqual(body, { name: "Invoices" });
	});

	it("sends the predicate and action on a rule change, so the server bumps ruleChangedAt", () => {
		const changed: FilterRule = {
			...original,
			matchOperator: "any",
			clauses: [{ id: "c", field: "ListId", value: "list.example.com" }],
			moveMailboxId: "mbx-archive",
		};
		const body = buildUpdateFilterInput(changed, original);
		assert.equal(body.matchOperator, "Or");
		assert.equal(body.actionMailboxId, "mbx-archive");
		assert.deepEqual(body.literalClauses, [
			{ field: "ListId", value: "list.example.com" },
		]);
		assert.equal("name" in body, false);
	});

	it("drops a cleared move target to the None sentinel", () => {
		const changed = {
			...original,
			moveMailboxId: undefined,
			matchOperator: "any" as const,
		};
		const body = buildUpdateFilterInput(changed, original);
		assert.equal(body.actionMailboxId, "None");
	});

	it("is empty when nothing changed", () => {
		assert.deepEqual(buildUpdateFilterInput(original, original), {});
	});
});
