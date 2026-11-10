import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClassificationPresetId } from "@remit/domain-enums";
import {
	CLASSIFICATION_PRESETS,
	classificationCost,
} from "./classification-presets.js";

describe("the cost of today's classification calls", () => {
	it("counts each call as 1,500 input tokens at the preset's price", () => {
		const cost = classificationCost(
			CLASSIFICATION_PRESETS[ClassificationPresetId.Jev],
			500,
		);

		assert.ok(cost.state === "Priced");
		assert.equal(cost.currency, "USD");
		assert.ok(Math.abs(cost.amount - 0.0315) < 1e-12, String(cost.amount));
	});

	it("is zero before the first call", () => {
		assert.deepEqual(
			classificationCost(CLASSIFICATION_PRESETS[ClassificationPresetId.Jev], 0),
			{ state: "Priced", currency: "USD", amount: 0 },
		);
	});

	it("carries no cost for a preset with no price", () => {
		assert.deepEqual(
			classificationCost(
				CLASSIFICATION_PRESETS[ClassificationPresetId.Local],
				500,
			),
			{ state: "NoPrice" },
		);
	});
});
