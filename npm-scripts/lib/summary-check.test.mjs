import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const LIB = join(LIB_DIR, "summary-check.sh");

// Read as text, not imported: this suite runs in the install-free CI job
// (no npm ci, no node_modules — see .github/workflows/ci.yml's validate job),
// so it cannot depend on @remit/data-ports resolving as a package. Reading
// the schema's exported constant as text keeps the same single source of
// truth without that dependency.
function readSchemaSummaryMaxLength() {
	const schemaPath = join(
		LIB_DIR,
		"..",
		"..",
		"packages/data-ports/src/update-manifest.ts",
	);
	const source = readFileSync(schemaPath, "utf8");
	const match = source.match(/^export const SUMMARY_MAX_LENGTH = (\d+);$/m);
	if (!match) {
		throw new Error(`could not read SUMMARY_MAX_LENGTH from ${schemaPath}`);
	}
	return Number(match[1]);
}

const SUMMARY_MAX_LENGTH = readSchemaSummaryMaxLength();

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
