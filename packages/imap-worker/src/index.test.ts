import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseReceiveCount } from "./index.js";

describe("parseReceiveCount — SQS ApproximateReceiveCount parsing", () => {
	it("parses the raw string attribute", () => {
		assert.equal(parseReceiveCount("1"), 1);
		assert.equal(parseReceiveCount("3"), 3);
	});

	it("defaults to 1 when the attribute is missing", () => {
		// A record with no attribute (e.g. an older local harness) is treated as
		// a first attempt, not fast-forwarded into retry-exhaustion handling.
		assert.equal(parseReceiveCount(undefined), 1);
	});

	it("defaults to 1 on a non-numeric or non-positive value", () => {
		assert.equal(parseReceiveCount("not-a-number"), 1);
		assert.equal(parseReceiveCount("0"), 1);
		assert.equal(parseReceiveCount("-1"), 1);
	});
});
