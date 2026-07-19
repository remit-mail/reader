import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrganizeInput } from "@remit/api-openapi-types";
import { FilterMatchOperator } from "@remit/domain-enums";
import { predicateFromInput } from "./organize.js";

const input = (over: Partial<OrganizeInput> = {}): OrganizeInput => ({
	matchOperator: FilterMatchOperator.And,
	literalClauses: [],
	actionLabelId: "None",
	actionMailboxId: "None",
	...over,
});

// A move back-apply is accepted end to end: createOrganizeJob and
// previewOrganize no longer reject `actionMailboxId` up front (the removed
// label-only 400). Both endpoints flatten the request into the predicate the
// job row and the matcher share, so the proof of acceptance is that the move
// action survives that mapping verbatim — the worker then applies it through
// the wired placement mover (see service/organize.test.ts).
describe("predicateFromInput (move back-apply accepted)", () => {
	it("carries a requested move action through to the predicate", () => {
		const predicate = predicateFromInput(
			input({ actionMailboxId: "mbox-target" }),
		);
		assert.equal(predicate.actionMailboxId, "mbox-target");
		assert.equal(predicate.actionLabelId, "None");
	});

	it("carries a combined move + label action through to the predicate", () => {
		const predicate = predicateFromInput(
			input({ actionLabelId: "lbl-1", actionMailboxId: "mbox-target" }),
		);
		assert.equal(predicate.actionMailboxId, "mbox-target");
		assert.equal(predicate.actionLabelId, "lbl-1");
	});

	it("preserves the None sentinel for an absent action", () => {
		const predicate = predicateFromInput(input());
		assert.equal(predicate.actionMailboxId, "None");
		assert.equal(predicate.actionLabelId, "None");
	});
});
