import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageItem } from "@remit/data-ports";
import { PlacementAction, PlacementConfidence } from "@remit/domain-enums";
import { deriveAutoMoved } from "./autoMoved.js";

type AutoMovedInput = Pick<
	MessageItem,
	"movedByRemit" | "placementVerdict" | "filterMove"
>;

const confidentVerdict = {
	action: PlacementAction.MoveToInbox,
	confidence: PlacementConfidence.Confident,
	fromPlacement: "junk",
	reasons: ["provider=spam", "dmarc=pass"],
	dryRun: false,
	decidedAt: 1_700_000_000_000,
};

const filterMove = {
	filterId: "flt-1",
	sourceMailboxId: "mb-inbox",
	destinationMailboxId: "mb-travel",
	decidedAt: 1_700_000_000_000,
};

describe("deriveAutoMoved", () => {
	it("returns undefined when the message was not moved by Remit", () => {
		const message: AutoMovedInput = {
			movedByRemit: false,
			placementVerdict: confidentVerdict,
		};
		assert.equal(deriveAutoMoved(message), undefined);
	});

	it("projects a standing-filter move to its mailbox ids and filter id", () => {
		const message: AutoMovedInput = { movedByRemit: true, filterMove };
		assert.deepEqual(deriveAutoMoved(message), {
			fromMailboxId: "mb-inbox",
			destinationMailboxId: "mb-travel",
			filterId: "flt-1",
		});
	});

	it("never leaks the classifier action/fromPlacement for a filter move", () => {
		const result = deriveAutoMoved({ movedByRemit: true, filterMove });
		assert.equal(result?.action, undefined);
		assert.equal(result?.fromPlacement, undefined);
	});

	it("a filter move outranks a co-present placement verdict", () => {
		// Both a filter move and a classifier verdict can be recorded; the filter's
		// exclusive move is what ultimately placed the message (RFC 034 Dec. 3.1).
		const message: AutoMovedInput = {
			movedByRemit: true,
			filterMove,
			placementVerdict: confidentVerdict,
		};
		assert.deepEqual(deriveAutoMoved(message), {
			fromMailboxId: "mb-inbox",
			destinationMailboxId: "mb-travel",
			filterId: "flt-1",
		});
	});

	it("projects a confident classifier move to action + fromPlacement", () => {
		const message: AutoMovedInput = {
			movedByRemit: true,
			placementVerdict: confidentVerdict,
		};
		assert.deepEqual(deriveAutoMoved(message), {
			action: PlacementAction.MoveToInbox,
			fromPlacement: "junk",
		});
	});

	it("drops an unsure classifier verdict", () => {
		const message: AutoMovedInput = {
			movedByRemit: true,
			placementVerdict: {
				...confidentVerdict,
				confidence: PlacementConfidence.Unsure,
			},
		};
		assert.equal(deriveAutoMoved(message), undefined);
	});

	it("drops a dry-run classifier verdict", () => {
		const message: AutoMovedInput = {
			movedByRemit: true,
			placementVerdict: { ...confidentVerdict, dryRun: true },
		};
		assert.equal(deriveAutoMoved(message), undefined);
	});

	it("does not crash on legacy verdict-less, filter-less moved data", () => {
		// A message moved before either the verdict or the filter marker existed:
		// movedByRemit is set but nothing is derivable. Must return undefined, not
		// throw (issue #223 back-compat).
		const message: AutoMovedInput = { movedByRemit: true };
		assert.equal(deriveAutoMoved(message), undefined);
	});
});
