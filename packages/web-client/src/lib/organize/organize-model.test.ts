import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildCreateFilterInput,
	buildOrganizeInput,
	hasCommittableAction,
	NO_ACTION,
	type OrganizeDraft,
} from "./organize-model";

const baseDraft = (overrides: Partial<OrganizeDraft> = {}): OrganizeDraft => ({
	matchOperator: "And",
	literalClauses: [],
	...overrides,
});

describe("hasCommittableAction", () => {
	it("is false when no move target is chosen — labeling has no backend yet, so a keep-in-place draft has nothing to commit", () => {
		assert.equal(hasCommittableAction(baseDraft()), false);
	});

	it("is false for the None sentinel", () => {
		assert.equal(
			hasCommittableAction(baseDraft({ moveMailboxId: NO_ACTION })),
			false,
		);
	});

	it("is true once a real destination mailbox is chosen", () => {
		assert.equal(
			hasCommittableAction(baseDraft({ moveMailboxId: "mbx-1" })),
			true,
		);
	});
});

describe("buildOrganizeInput", () => {
	it("carries the anchor and defaults the action to None when no move is set", () => {
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

	it("labels the label action None even when a move target is set — label writes have no endpoint", () => {
		const input = buildOrganizeInput(
			baseDraft({ anchorMessageId: "msg-1", moveMailboxId: "mbx-9" }),
		);
		assert.equal(input.actionMailboxId, "mbx-9");
		assert.equal(input.actionLabelId, NO_ACTION);
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
});
