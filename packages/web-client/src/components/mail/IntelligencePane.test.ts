import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveSpamAction } from "./IntelligencePane";

describe("resolveSpamAction (#648)", () => {
	test("offers Report spam when the message carries no spam report", () => {
		assert.equal(resolveSpamAction({}), "reportSpam");
	});

	test("offers Not spam once the message carries a spam report", () => {
		assert.equal(
			resolveSpamAction({ spamReport: { reportedAt: Date.now() } }),
			"notSpam",
		);
	});
});
