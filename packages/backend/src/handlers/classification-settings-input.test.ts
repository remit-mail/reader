import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClassificationPresetId } from "@remit/domain-enums";
import { decideClassificationProvider } from "./classification-settings.js";

describe("a classification provider save", () => {
	it("refuses a base URL that is not an http or https URL", () => {
		for (const classificationBaseUrl of [
			"not a url",
			"ftp://models.example",
			"javascript:alert(1)",
		]) {
			const decided = decideClassificationProvider(
				{
					classificationPresetId: ClassificationPresetId.OpenAiCompatible,
					classificationBaseUrl,
					classificationApiKey: "k",
				},
				{ state: "NotConfigured" },
			);

			assert.ok(!decided.ok, classificationBaseUrl);
			assert.equal(decided.error.code, "InvalidClassificationBaseUrl");
			assert.match(decided.error.message, /classificationBaseUrl/);
		}
	});

	it("refuses a missing base URL for a preset without a default one", () => {
		const decided = decideClassificationProvider(
			{
				classificationPresetId: ClassificationPresetId.OpenAiCompatible,
				classificationBaseUrl: "  ",
				classificationApiKey: "k",
			},
			{ state: "NotConfigured" },
		);

		assert.ok(!decided.ok);
		assert.equal(decided.error.code, "InvalidClassificationBaseUrl");
		assert.match(decided.error.message, /classificationBaseUrl/);
	});

	it("takes the default base URL for a preset that has one", () => {
		const decided = decideClassificationProvider(
			{
				classificationPresetId: ClassificationPresetId.Mistral,
				classificationApiKey: "k",
			},
			{ state: "NotConfigured" },
		);

		assert.ok(decided.ok);
		assert.equal(decided.value.baseUrl, "https://api.eu.mistral.ai/v1");
	});
});
