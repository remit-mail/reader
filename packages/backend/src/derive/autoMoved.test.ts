import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageItem } from "@remit/remit-electrodb-service";
import { PlacementAction, PlacementConfidence } from "@remit/domain-enums";
import { deriveAutoMoved } from "./autoMoved.js";

const DECIDED_AT = 1_700_000_000_000;

const buildVerdict = (
	overrides: Partial<NonNullable<MessageItem["placementVerdict"]>> = {},
): NonNullable<MessageItem["placementVerdict"]> => ({
	action: PlacementAction.MoveToInbox,
	confidence: PlacementConfidence.Confident,
	fromPlacement: "junk",
	reasons: ["provider=spam", "dmarc=pass", "sender=vip"],
	dryRun: false,
	decidedAt: DECIDED_AT,
	...overrides,
});

describe("deriveAutoMoved", () => {
	it("returns undefined when movedByRemit is false", () => {
		const result = deriveAutoMoved({
			movedByRemit: false,
			placementVerdict: buildVerdict(),
		});
		assert.equal(result, undefined);
	});

	it("returns undefined when placementVerdict is absent", () => {
		const result = deriveAutoMoved({ movedByRemit: true });
		assert.equal(result, undefined);
	});

	it("returns undefined for an unsure verdict", () => {
		const result = deriveAutoMoved({
			movedByRemit: true,
			placementVerdict: buildVerdict({
				confidence: PlacementConfidence.Unsure,
			}),
		});
		assert.equal(result, undefined);
	});

	it("returns undefined for a dry-run verdict", () => {
		const result = deriveAutoMoved({
			movedByRemit: true,
			placementVerdict: buildVerdict({ dryRun: true }),
		});
		assert.equal(result, undefined);
	});

	it("returns action + fromPlacement for a confident, non-dry-run move", () => {
		const result = deriveAutoMoved({
			movedByRemit: true,
			placementVerdict: buildVerdict({
				action: PlacementAction.MoveToInbox,
				fromPlacement: "junk",
			}),
		});
		assert.deepEqual(result, {
			action: PlacementAction.MoveToInbox,
			fromPlacement: "junk",
		});
	});

	it("never leaks confidence, dryRun, decidedAt or reasons", () => {
		const result = deriveAutoMoved({
			movedByRemit: true,
			placementVerdict: buildVerdict(),
		});
		assert.deepEqual(Object.keys(result ?? {}).sort(), [
			"action",
			"fromPlacement",
		]);
	});

	it("handles a move-to-junk verdict from inbox", () => {
		const result = deriveAutoMoved({
			movedByRemit: true,
			placementVerdict: buildVerdict({
				action: PlacementAction.MoveToJunk,
				fromPlacement: "inbox",
			}),
		});
		assert.deepEqual(result, {
			action: PlacementAction.MoveToJunk,
			fromPlacement: "inbox",
		});
	});
});
