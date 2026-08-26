import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrganizeInput } from "@remit/api-openapi-types";
import { BadRequestError } from "@remit/data-ports/errors";
import { FilterMatchOperator } from "@remit/domain-enums";
import { handleError } from "../error.js";
import { organizePredicateRejection } from "../service/organize.js";
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

// createOrganizeJob refuses the same rule preview refuses, on the request,
// instead of handing back a 202 for a job the worker can only fail (reader
// #463). The check runs on the flattened predicate, so the proof is that a
// request body the client actually sends still reaches it.
describe("createOrganizeJob rejected-rule refusal (reader #463)", () => {
	it("refuses an anchorless body-content clause before a job row exists", () => {
		const rejection = organizePredicateRejection(
			predicateFromInput(
				input({ literalClauses: [{ field: "HasWords", value: "invoice" }] }),
			),
		);

		assert.match(String(rejection?.message), /HasWords/);
	});

	it("accepts the same clause when the request carries an anchor to widen from", () => {
		assert.equal(
			organizePredicateRejection(
				predicateFromInput(
					input({
						anchorMessageId: "msg-anchor",
						literalClauses: [{ field: "HasWords", value: "invoice" }],
					}),
				),
			),
			null,
		);
	});
});

// The matcher returns a body-content (HasWords) refusal as a result (see
// service/organize.test.ts); previewOrganize is the boundary that words it as a
// BadRequestError. Proving the 4xx actually reaches the wire — not just that the
// right class is raised — means proving the shared error handler maps it, since
// a plain Error would otherwise fall through to a 500 (reader #457).
describe("previewOrganize rejected-rule response (reader #457)", () => {
	it("maps a rejected HasWords clause to a 400 naming the reason, not a 500", async () => {
		const error = new BadRequestError(
			"Organize literal matching cannot evaluate a body-content (HasWords) clause without the vector pipeline — it requires the semantic widen path",
		);

		const response = await handleError(error);

		assert.equal(response.statusCode, 400);
		assert.match(JSON.parse(response.body).message, /HasWords/);
	});
});
