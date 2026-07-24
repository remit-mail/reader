import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "roster-publish.sh");

function decide(...verdicts) {
	return execFileSync(
		"bash",
		[
			"-c",
			'source "$1"; shift; roster_build_decision "$@"',
			"decide",
			LIB,
			...verdicts,
		],
		{ encoding: "utf8" },
	).trim();
}

describe("roster_build_decision", () => {
	it("skips when every image is already present at the tag", () => {
		assert.equal(decide("exists", "exists", "exists"), "false");
	});

	// The nightly's whole reason to exist: a commit reached main with no manual
	// build, so at least one image is missing at its sha tag.
	it("builds when any image is missing", () => {
		assert.equal(decide("exists", "absent", "exists"), "true");
	});

	// abort is a never-published new service or a transient read error. Either
	// way the nightly builds — a real auth/push failure then surfaces loudly in
	// build-and-push rather than being masked here as a skip.
	it("builds when any image cannot be confirmed", () => {
		assert.equal(decide("exists", "abort", "exists"), "true");
	});

	it("builds when nothing is present yet", () => {
		assert.equal(decide("absent", "absent"), "true");
	});
});
