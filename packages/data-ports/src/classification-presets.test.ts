import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ClassificationAdapterShape,
	ClassificationPresetId,
} from "@remit/domain-enums";
import {
	CLASSIFICATION_PRESETS,
	findClassificationPreset,
} from "./classification-presets.js";

describe("the classification presets", () => {
	it("hold exactly one row per preset id", () => {
		assert.deepEqual(
			CLASSIFICATION_PRESETS.map((preset) => preset.presetId).sort(),
			Object.values(ClassificationPresetId).sort(),
		);
	});

	it("give every preset that does not ask for a base URL a default one", () => {
		for (const preset of CLASSIFICATION_PRESETS) {
			if (preset.needsBaseUrl) continue;
			assert.ok(URL.canParse(preset.defaultBaseUrl), preset.presetId);
			assert.notEqual(preset.defaultModel, "", preset.presetId);
		}
	});

	it("price Jev per million input tokens and call it on the decision api", () => {
		const jev = findClassificationPreset(ClassificationPresetId.Jev);
		assert.ok(jev);
		assert.equal(jev.adapterShape, ClassificationAdapterShape.DecisionApi);
		assert.equal(jev.defaultBaseUrl, "https://api.typesafe.ai");
		assert.equal(jev.defaultModel, "jev-latest");
		assert.deepEqual(jev.price, {
			state: "Priced",
			currency: "USD",
			perMillionInputTokens: 0.042,
		});
	});

	it("run Local on localhost without a key and with a base URL", () => {
		const local = findClassificationPreset(ClassificationPresetId.Local);
		assert.ok(local);
		assert.equal(local.needsKey, false);
		assert.equal(local.needsBaseUrl, true);
		assert.equal(local.defaultBaseUrl, "http://localhost:8080");
		assert.equal(local.defaultModel, "clef-flash");
		assert.equal(local.adapterShape, ClassificationAdapterShape.DecisionApi);
	});

	it("ask a key of every hosted preset and a base URL of the OpenAI-compatible one", () => {
		const compatible = findClassificationPreset(
			ClassificationPresetId.OpenAiCompatible,
		);
		assert.ok(compatible);
		assert.equal(compatible.needsBaseUrl, true);
		assert.equal(compatible.needsKey, true);
		for (const id of [
			ClassificationPresetId.Jev,
			ClassificationPresetId.Jina,
			ClassificationPresetId.Mistral,
			ClassificationPresetId.Gemini,
		]) {
			assert.equal(findClassificationPreset(id)?.needsKey, true, id);
		}
	});

	it("find nothing for an unknown id", () => {
		assert.equal(findClassificationPreset("Cohere"), undefined);
	});
});
