import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLASSIFICATION_PRESETS } from "@remit/data-ports/classification-presets";
import { classificationDefaultFromEnv } from "./classification-default.js";

describe("classificationDefaultFromEnv", () => {
	it("has no default without a preset", () => {
		assert.deepEqual(classificationDefaultFromEnv({}), { state: "None" });
		assert.deepEqual(
			classificationDefaultFromEnv({ CLASSIFICATION_DEFAULT_PRESET: "" }),
			{ state: "None" },
		);
	});

	it("fills each preset's defaults when only the preset and key are set", () => {
		for (const preset of Object.values(CLASSIFICATION_PRESETS)) {
			const baseUrl = preset.defaultBaseUrl ?? "https://llm.example.com/v1";
			assert.deepEqual(
				classificationDefaultFromEnv({
					CLASSIFICATION_DEFAULT_PRESET: preset.presetId,
					CLASSIFICATION_DEFAULT_API_KEY: "sk-test",
					CLASSIFICATION_DEFAULT_BASE_URL: preset.defaultBaseUrl ? "" : baseUrl,
				}),
				{
					state: "Configured",
					presetId: preset.presetId,
					model: preset.defaultModel,
					baseUrl,
					apiKey: "sk-test",
					enabled: false,
					dailyLimit: 500,
				},
				preset.presetId,
			);
		}
	});

	it("takes every value that is set", () => {
		assert.deepEqual(
			classificationDefaultFromEnv({
				CLASSIFICATION_DEFAULT_PRESET: "Mistral",
				CLASSIFICATION_DEFAULT_MODEL: "mistral-small-latest",
				CLASSIFICATION_DEFAULT_BASE_URL: "https://api.mistral.ai/v1",
				CLASSIFICATION_DEFAULT_API_KEY: "sk-test",
				CLASSIFICATION_DEFAULT_ENABLED: "true",
				CLASSIFICATION_DEFAULT_DAILY_LIMIT: "2000",
			}),
			{
				state: "Configured",
				presetId: "Mistral",
				model: "mistral-small-latest",
				baseUrl: "https://api.mistral.ai/v1",
				apiKey: "sk-test",
				enabled: true,
				dailyLimit: 2000,
			},
		);
	});

	it("starts a keyless preset without a key", () => {
		const parsed = classificationDefaultFromEnv({
			CLASSIFICATION_DEFAULT_PRESET: "Local",
		});
		assert.equal(parsed.state, "Configured");
	});

	it("refuses an unknown preset", () => {
		assert.throws(
			() =>
				classificationDefaultFromEnv({
					CLASSIFICATION_DEFAULT_PRESET: "Bogus",
				}),
			/CLASSIFICATION_DEFAULT_PRESET=Bogus is not a known preset/,
		);
	});

	it("refuses a preset that needs a key when none is set", () => {
		assert.throws(
			() =>
				classificationDefaultFromEnv({
					CLASSIFICATION_DEFAULT_PRESET: "Mistral",
				}),
			/CLASSIFICATION_DEFAULT_API_KEY is not set/,
		);
	});

	it("refuses a preset without a default base URL when none is set", () => {
		assert.throws(
			() =>
				classificationDefaultFromEnv({
					CLASSIFICATION_DEFAULT_PRESET: "OpenAiCompatible",
					CLASSIFICATION_DEFAULT_API_KEY: "sk-test",
				}),
			/CLASSIFICATION_DEFAULT_BASE_URL is not set/,
		);
	});

	it("refuses a limit that is not a positive integer", () => {
		for (const limit of ["0", "-5", "1.5", "lots", "1e3"]) {
			assert.throws(
				() =>
					classificationDefaultFromEnv({
						CLASSIFICATION_DEFAULT_PRESET: "Local",
						CLASSIFICATION_DEFAULT_DAILY_LIMIT: limit,
					}),
				new RegExp(
					`CLASSIFICATION_DEFAULT_DAILY_LIMIT=${limit.replace(".", "\\.")} must be a positive integer`,
				),
				limit,
			);
		}
	});

	it("refuses an enabled value that is not true or false", () => {
		assert.throws(
			() =>
				classificationDefaultFromEnv({
					CLASSIFICATION_DEFAULT_PRESET: "Local",
					CLASSIFICATION_DEFAULT_ENABLED: "yes",
				}),
			/CLASSIFICATION_DEFAULT_ENABLED=yes must be true or false/,
		);
	});

	it("refuses any value set without a preset", () => {
		assert.throws(
			() =>
				classificationDefaultFromEnv({
					CLASSIFICATION_DEFAULT_API_KEY: "sk-test",
					CLASSIFICATION_DEFAULT_DAILY_LIMIT: "10",
				}),
			/CLASSIFICATION_DEFAULT_API_KEY, CLASSIFICATION_DEFAULT_DAILY_LIMIT set without CLASSIFICATION_DEFAULT_PRESET/,
		);
	});
});
