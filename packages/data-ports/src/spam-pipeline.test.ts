import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spamPipelineFromEnv } from "./spam-pipeline.js";

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
			{ name: "Model", thresholds: { state: "Unset" } },
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
			/thresholds/,
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
			[{ name: "Model", thresholds: { state: "Unset" } }],
			/needs a judge other than Model/,
		],
	];
	for (const [name, judges, message] of refused) {
		it(`refuses ${name}`, () => {
			assert.throws(() => pipeline(judges), message);
		});
	}

	it("refuses a value that is not JSON", () => {
		assert.throws(
			() => spamPipelineFromEnv({ SPAM_PIPELINE: "Inline" }),
			/SPAM_PIPELINE is not JSON/,
		);
	});
});
