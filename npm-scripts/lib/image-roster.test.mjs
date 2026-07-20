import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "image-roster.sh");

function makeFixture(runtimeTargets, { withApisix = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), "image-roster-"));
	if (withApisix) mkdirSync(join(root, "apisix"));
	for (const target of runtimeTargets) {
		mkdirSync(join(root, "docker", "runtime", target), { recursive: true });
	}
	return root;
}

function roster(fixtureDir) {
	const out = execFileSync(
		"bash",
		[
			"-c",
			'cd "$1" && source "$2" && image_roster && printf "%s\\n" "${ALL_TARGETS[@]}"',
			"roster",
			fixtureDir,
			LIB,
		],
		{ encoding: "utf8" },
	);
	return out.split("\n").filter(Boolean);
}

function assertNonemptyExitCode(fixtureDir) {
	const script =
		'cd "$1" && source "$2" && ALL_TARGETS=() && assert_roster_nonempty';
	return spawnSync("bash", ["-c", script, "assert", fixtureDir, LIB], {
		encoding: "utf8",
	}).status;
}

describe("image_roster", () => {
	// The regression this guards: a previous version built the array through
	// `mapfile` over process substitution, which reads to EOF whether the
	// subshell producing the roster exited cleanly or died partway — a mid-loop
	// failure could silently truncate the roster with no non-zero exit for the
	// caller to catch. Populating the array directly in the caller's shell, as
	// here, can't do that: there is no subshell boundary to hide a failure
	// behind.
	it("lists apisix plus every docker/runtime target", () => {
		const fixture = makeFixture(["backend", "web", "smtp-worker"]);
		try {
			// docker/runtime/*/ globs in lexicographic order, not insertion order.
			assert.deepEqual(roster(fixture), [
				"apisix",
				"backend",
				"smtp-worker",
				"web",
			]);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	it("omits apisix when its directory is absent", () => {
		const fixture = makeFixture(["backend"], { withApisix: false });
		try {
			assert.deepEqual(roster(fixture), ["backend"]);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	it("reflects every docker/runtime/* directory present, not a fixed count", () => {
		const fixture = makeFixture(["a", "b", "c", "d", "e"]);
		try {
			assert.equal(roster(fixture).length, 6);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});

describe("assert_roster_nonempty", () => {
	it("exits non-zero on an empty roster instead of letting the caller continue", () => {
		const fixture = makeFixture([], { withApisix: false });
		try {
			assert.equal(assertNonemptyExitCode(fixture), 1);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	it("is a no-op when the roster is non-empty", () => {
		const fixture = makeFixture(["backend"]);
		try {
			execFileSync(
				"bash",
				[
					"-c",
					'cd "$1" && source "$2" && image_roster && assert_roster_nonempty && echo ok',
					"assert",
					fixture,
					LIB,
				],
				{ encoding: "utf8" },
			);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});
