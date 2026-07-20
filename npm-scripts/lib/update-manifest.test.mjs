import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertValidVersion, extractSummary } from "./update-manifest.mjs";

describe("assertValidVersion", () => {
	it("accepts vX.Y.Z", () => {
		assert.doesNotThrow(() => assertValidVersion("v1.5.0"));
	});

	it("rejects a version without the v prefix", () => {
		assert.throws(() => assertValidVersion("1.5.0"));
	});

	it("rejects a partial version", () => {
		assert.throws(() => assertValidVersion("v1.5"));
	});

	it("rejects a pre-release suffix", () => {
		assert.throws(() => assertValidVersion("v1.5.0-rc1"));
	});
});

describe("extractSummary", () => {
	it("takes the first line of the tag message", () => {
		assert.equal(
			extractSummary("Faster search.\n\nSome trailer nobody reads."),
			"Faster search.",
		);
	});

	it("trims surrounding whitespace", () => {
		assert.equal(extractSummary("  Faster search.  \n"), "Faster search.");
	});

	it("refuses an empty message", () => {
		assert.throws(() => extractSummary(""), /no summary line/);
	});

	it("refuses a message that is only whitespace", () => {
		assert.throws(() => extractSummary("   \n\n"), /no summary line/);
	});

	it("accepts a summary at exactly 140 characters", () => {
		const summary = "x".repeat(140);
		assert.equal(extractSummary(summary), summary);
	});

	it("refuses a summary over 140 characters", () => {
		assert.throws(() => extractSummary("x".repeat(141)), /at most 140/);
	});
});
