import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SUMMARY_MAX_LENGTH } from "@remit/data-ports/update-manifest";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "summary-check.sh");

function validate(summary) {
	return execFileSync("bash", ["-c", 'source "$1"; validate_summary "$2"', "validate", LIB, summary], {
		encoding: "utf8",
	}).replace(/\n$/, "");
}

function readShellSummaryMaxLength() {
	return execFileSync("bash", ["-c", 'source "$1"; echo "$SUMMARY_MAX_LENGTH"', "read", LIB], {
		encoding: "utf8",
	}).trim();
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

	// Derived from the schema's own SUMMARY_MAX_LENGTH — see the binding test
	// below — so these boundaries move with the schema instead of drifting.
	it("accepts exactly SUMMARY_MAX_LENGTH characters", () => {
		assert.equal(validate("a".repeat(SUMMARY_MAX_LENGTH)), "");
	});

	it("rejects SUMMARY_MAX_LENGTH + 1 characters", () => {
		assert.match(
			validate("a".repeat(SUMMARY_MAX_LENGTH + 1)),
			new RegExp(String(SUMMARY_MAX_LENGTH)),
		);
	});
});

describe("SUMMARY_MAX_LENGTH", () => {
	it("is read from the schema, not hand-copied", () => {
		assert.equal(readShellSummaryMaxLength(), String(SUMMARY_MAX_LENGTH));
	});
});
