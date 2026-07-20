import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "summary-check.sh");

function validate(summary) {
	return execFileSync("bash", ["-c", 'source "$1"; validate_summary "$2"', "validate", LIB, summary], {
		encoding: "utf8",
	}).replace(/\n$/, "");
}

describe("validate_summary", () => {
	it("accepts a normal one-line summary", () => {
		assert.equal(validate("Fixes the sync retry loop and speeds up search indexing."), "");
	});

	it("rejects an empty summary rather than defaulting it", () => {
		assert.match(validate(""), /empty/);
	});

	it("rejects a multi-line summary", () => {
		assert.match(validate("first line\nsecond line"), /one line/);
	});

	// Kept in sync with packages/data-ports/src/update-manifest.ts's
	// `summary: z.string().min(1).max(140)`.
	it("accepts exactly 140 characters", () => {
		assert.equal(validate("a".repeat(140)), "");
	});

	it("rejects 141 characters", () => {
		assert.match(validate("a".repeat(141)), /140/);
	});
});
