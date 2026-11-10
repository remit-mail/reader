import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClassificationPresetId } from "@remit/domain-enums";
import {
	decideClassificationChange,
	decideClassificationProvider,
} from "./classification-settings.js";

describe("a classification daily limit", () => {
	const saved = {
		state: "Configured",
		presetId: ClassificationPresetId.Local,
		model: "clef-flash",
		baseUrl: "http://localhost:8080",
		apiKeySaved: false,
		apiKeyCiphertext: undefined,
		enabled: true,
		dailyLimit: 500,
		savedAt: 1,
	} as const;

	it("refuses a limit below 1 or not a whole number", () => {
		for (const classificationDailyLimit of [0, -3, 1.5, 499.99]) {
			const decided = decideClassificationChange(
				{ classificationDailyLimit },
				saved,
			);

			assert.ok(!decided.ok, String(classificationDailyLimit));
			assert.equal(decided.error.code, "InvalidClassificationDailyLimit");
			assert.equal(decided.error.message, "Enter a whole number of 1 or more.");
		}
	});

	it("takes a whole number of 1 or more", () => {
		for (const classificationDailyLimit of [1, 500, 10_000]) {
			const decided = decideClassificationChange(
				{ classificationDailyLimit },
				saved,
			);

			assert.ok(decided.ok);
			assert.equal(decided.value.dailyLimit, classificationDailyLimit);
		}
	});
});

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
