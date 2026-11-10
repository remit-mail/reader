import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClassificationResolverInput } from "@remit/data-ports/classification-resolver";
import { ClassificationPresetId } from "@remit/domain-enums";
import { decideClassificationChange } from "./classification-settings.js";

const nothingSaved: ClassificationResolverInput = {
	rows: [],
	deployment: { state: "None" },
	accountConfigCreatedAt: 0,
};

describe("a classification provider save", () => {
	it("refuses a base URL that is not an http or https URL", () => {
		for (const classificationBaseUrl of [
			"not a url",
			"ftp://models.example",
			"javascript:alert(1)",
		]) {
			const decided = decideClassificationChange(nothingSaved, {
				classificationPresetId: ClassificationPresetId.OpenAiCompatible,
				classificationBaseUrl,
				classificationApiKey: "k",
			});

			assert.ok(!decided.ok, classificationBaseUrl);
			assert.equal(decided.error.code, "InvalidClassificationBaseUrl");
			assert.match(decided.error.message, /classificationBaseUrl/);
		}
	});

	it("refuses a missing base URL for a preset without a default one", () => {
		const decided = decideClassificationChange(nothingSaved, {
			classificationPresetId: ClassificationPresetId.OpenAiCompatible,
			classificationBaseUrl: "  ",
			classificationApiKey: "k",
		});

		assert.ok(!decided.ok);
		assert.equal(decided.error.code, "InvalidClassificationBaseUrl");
		assert.match(decided.error.message, /classificationBaseUrl/);
	});

	it("takes the default base URL for a preset that has one", () => {
		const decided = decideClassificationChange(nothingSaved, {
			classificationPresetId: ClassificationPresetId.Mistral,
			classificationApiKey: "k",
		});

		assert.ok(decided.ok);
		assert.equal(decided.value.resolved.state, "Configured");
		assert.deepEqual(
			decided.value.resolved.state === "Configured" &&
				decided.value.resolved.baseUrl,
			{ value: "https://api.eu.mistral.ai/v1", source: "Default" },
		);
	});
});
