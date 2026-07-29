import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RuleClause } from "@remit/ui";
import {
	buildCreateFilterInput,
	buildOrganizeInput,
	buildWizardDraft,
	hasCommittableAction,
	NO_ACTION,
	type OrganizeDraft,
	organizeScopeFor,
} from "./organize-model";

const baseDraft = (overrides: Partial<OrganizeDraft> = {}): OrganizeDraft => ({
	matchOperator: "And",
	literalClauses: [],
	...overrides,
});

describe("hasCommittableAction", () => {
	it("is false when neither a move nor a label is chosen — a keep-in-place draft has nothing to commit", () => {
		assert.equal(hasCommittableAction(baseDraft()), false);
	});

	it("is false for the None sentinel on both actions", () => {
		assert.equal(
			hasCommittableAction(
				baseDraft({ moveMailboxId: NO_ACTION, labelId: NO_ACTION }),
			),
			false,
		);
	});

	it("is true once a real destination mailbox is chosen", () => {
		assert.equal(
			hasCommittableAction(baseDraft({ moveMailboxId: "mbx-1" })),
			true,
		);
	});

	it("is true once a real label is chosen, with no move target (issue #26)", () => {
		assert.equal(hasCommittableAction(baseDraft({ labelId: "lbl-1" })), true);
	});

	it("is true when both a move and a label are chosen", () => {
		assert.equal(
			hasCommittableAction(
				baseDraft({ moveMailboxId: "mbx-1", labelId: "lbl-1" }),
			),
			true,
		);
	});
});

describe("buildOrganizeInput", () => {
	it("carries the anchor and defaults both actions to None when neither is set", () => {
		const input = buildOrganizeInput(baseDraft({ anchorMessageId: "msg-1" }));
		assert.equal(input.anchorMessageId, "msg-1");
		assert.equal(input.actionMailboxId, NO_ACTION);
		assert.equal(input.actionLabelId, NO_ACTION);
		assert.equal(input.matchOperator, "And");
		assert.deepEqual(input.literalClauses, []);
	});

	it("omits anchorMessageId entirely for a purely-literal input", () => {
		const input = buildOrganizeInput(
			baseDraft({
				literalClauses: [{ field: "From", value: "airbnb.com" }],
			}),
		);
		assert.equal("anchorMessageId" in input, false);
	});

	it("carries the move and label actions independently (issue #26)", () => {
		const input = buildOrganizeInput(
			baseDraft({
				anchorMessageId: "msg-1",
				moveMailboxId: "mbx-9",
				labelId: "lbl-9",
			}),
		);
		assert.equal(input.actionMailboxId, "mbx-9");
		assert.equal(input.actionLabelId, "lbl-9");
	});
});

describe("buildCreateFilterInput", () => {
	it("builds a Standing filter with no expiresAt", () => {
		const input = buildCreateFilterInput(
			baseDraft({ anchorMessageId: "msg-1", moveMailboxId: "mbx-2" }),
			"standing",
			"Travel",
		);
		assert.equal(input.scope, "Standing");
		assert.equal("expiresAt" in input, false);
		assert.equal(input.name, "Travel");
		assert.equal(input.actionMailboxId, "mbx-2");
		assert.equal(input.actionLabelId, NO_ACTION);
		assert.equal(input.anchorMessageId, "msg-1");
	});

	it("builds a Temporary filter that carries expiresAt", () => {
		const input = buildCreateFilterInput(
			baseDraft({
				moveMailboxId: "mbx-2",
				expiresAt: "2026-07-16T23:59:59+02:00",
			}),
			"temporary",
			"Trip",
		);
		assert.equal(input.scope, "Temporary");
		assert.equal(input.expiresAt, "2026-07-16T23:59:59+02:00");
	});

	it("never sends a client-side ttl — the server derives it from expiresAt", () => {
		const input = buildCreateFilterInput(
			baseDraft({
				moveMailboxId: "mbx-2",
				expiresAt: "2026-07-16T23:59:59+02:00",
			}),
			"temporary",
			"Trip",
		);
		assert.equal("ttl" in input, false);
	});

	it("carries a label action (issue #26)", () => {
		const input = buildCreateFilterInput(
			baseDraft({ labelId: "lbl-1" }),
			"standing",
			"Receipts",
		);
		assert.equal(input.actionLabelId, "lbl-1");
	});
});

describe("organizeScopeFor", () => {
	it("reads the ticked list at scope once as just-these", () => {
		assert.equal(organizeScopeFor({ mode: "selected" }), "just-these");
		assert.equal(
			organizeScopeFor({ mode: "selected", ruleScope: "once" }),
			"just-these",
		);
	});

	it("reads either widened door at scope once as all-like-these", () => {
		assert.equal(organizeScopeFor({ mode: "similar" }), "all-like-these");
		assert.equal(
			organizeScopeFor({ mode: "properties", ruleScope: "once" }),
			"all-like-these",
		);
	});

	it("reads the two persisting scopes off the scope answer alone", () => {
		for (const mode of ["selected", "similar", "properties"] as const) {
			assert.equal(
				organizeScopeFor({ mode, ruleScope: "standing" }),
				"standing",
			);
			assert.equal(organizeScopeFor({ mode, ruleScope: "until" }), "temporary");
		}
	});
});

describe("buildWizardDraft", () => {
	const clauses: RuleClause[] = [
		{ id: "c1", field: "From", value: "noreply@booking.com" },
	];

	it("turns the until scope's civil date into a zoned expiresAt", () => {
		const draft = buildWizardDraft({
			mode: "properties",
			ruleScope: "until",
			clauses,
			matchOperator: "any",
			moveMailboxId: "mbx-2",
			until: "2026-09-30",
		});
		assert.match(
			draft.expiresAt ?? "",
			/^2026-09-30T23:59:59[+-]\d{2}:\d{2}$/,
			"the day the rule stops on becomes an instant with an offset",
		);
	});

	it("carries no expiry for the scopes that never expire", () => {
		for (const ruleScope of ["once", "standing"] as const) {
			const draft = buildWizardDraft({
				mode: "properties",
				ruleScope,
				clauses,
				matchOperator: "all",
				until: "2026-09-30",
			});
			assert.equal(draft.expiresAt, undefined);
		}
	});

	it("anchors on the ticked messages only while the similar door is matching", () => {
		const anchored = buildWizardDraft({
			mode: "similar",
			anchorMessageId: "msg-1",
			clauses: [],
			matchOperator: "all",
		});
		assert.equal(anchored.anchorMessageId, "msg-1");

		const literal = buildWizardDraft({
			mode: "properties",
			anchorMessageId: "msg-1",
			clauses,
			matchOperator: "any",
		});
		assert.equal("anchorMessageId" in literal, false);
	});

	it("maps the wizard's operator onto the API's", () => {
		assert.equal(
			buildWizardDraft({ mode: "properties", clauses, matchOperator: "all" })
				.matchOperator,
			"And",
		);
		assert.equal(
			buildWizardDraft({ mode: "properties", clauses, matchOperator: "any" })
				.matchOperator,
			"Or",
		);
	});

	it("sends the clause field and value, and nothing the chip carries besides", () => {
		const draft = buildWizardDraft({
			mode: "properties",
			clauses: [
				{ id: "c1", field: "Subject", value: "receipt", derived: true },
			],
			matchOperator: "all",
		});
		assert.deepEqual(draft.literalClauses, [
			{ field: "Subject", value: "receipt" },
		]);
	});
});
