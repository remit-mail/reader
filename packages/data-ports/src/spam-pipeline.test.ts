import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spamPipelineFromEnv } from "./spam-pipeline.js";

const SET = { state: "Set", cleanBelow: 0.3, spamAt: 0.8 };

const pipeline = (judges: unknown) =>
	spamPipelineFromEnv({ SPAM_PIPELINE: JSON.stringify(judges) });

describe("spamPipelineFromEnv", () => {
	it("runs the inline judge alone, thresholds unset, when nothing is set", () => {
		assert.deepEqual(spamPipelineFromEnv({}), [
			{ name: "Inline", thresholds: { state: "Unset" } },
		]);
	});

	it("keeps the judges in the order given", () => {
		const judges = [
			{
				name: "Inline",
				thresholds: { state: "Set", cleanBelow: 0.2, spamAt: 0.9 },
			},
			{ name: "Rspamd", url: "http://rspamd:11333" },
			{ name: "Model", thresholds: SET },
		];
		assert.deepEqual(pipeline(judges), judges);
	});

	const refused: [string, unknown, RegExp][] = [
		["an empty pipeline", [], /SPAM_PIPELINE/],
		["an unknown judge", [{ name: "SpamAssassin" }], /0\.name/],
		[
			"thresholds on rspamd",
			[
				{
					name: "Rspamd",
					url: "http://rspamd:11333",
					thresholds: { state: "Unset" },
				},
			],
			/fields no judge reads: 0\.thresholds/,
		],
		[
			"the model without thresholds",
			[
				{ name: "Inline", thresholds: { state: "Unset" } },
				{ name: "Model", thresholds: { state: "Unset" } },
			],
			/1\.thresholds/,
		],
		[
			"an rspamd URL that is not http",
			[{ name: "Rspamd", url: "rspamd:11333" }],
			/0\.url: must be an http or https URL/,
		],
		[
			"cleanBelow above spamAt",
			[
				{
					name: "Inline",
					thresholds: { state: "Set", cleanBelow: 0.9, spamAt: 0.2 },
				},
			],
			/cleanBelow must not exceed spamAt/,
		],
		[
			"a score above 1",
			[
				{
					name: "Inline",
					thresholds: { state: "Set", cleanBelow: 0.2, spamAt: 2 },
				},
			],
			/0\.thresholds/,
		],
		[
			"the model alone",
			[{ name: "Model", thresholds: SET }],
			/needs a judge other than Model/,
		],
	];
	for (const [name, judges, message] of refused) {
		it(`refuses ${name}`, () => {
			assert.throws(() => pipeline(judges), message);
		});
	}

	for (const key of [
		"SPAM_BACKEND",
		"SPAM_CLEAN_BELOW",
		"SPAM_AT",
		"SPAM_RSPAMD_URL",
	]) {
		it(`refuses ${key}, which SPAM_PIPELINE replaced`, () => {
			assert.throws(
				() => spamPipelineFromEnv({ [key]: "0.5" }),
				new RegExp(`${key} is no longer read.*SPAM_PIPELINE`),
			);
		});
	}

	it("refuses a value that is not JSON", () => {
		assert.throws(
			() => spamPipelineFromEnv({ SPAM_PIPELINE: "Inline" }),
			/SPAM_PIPELINE is not JSON/,
		);
	});
});
