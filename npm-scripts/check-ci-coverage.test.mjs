// End-to-end cover for the guard's seeding, which is what #448 was: the pure
// decisions in lib/ci-coverage.mjs were right and the entrypoint handed them a
// discovery CI never performs. Every case below runs the real script against a
// fixture tree, so a seed that stops matching what CI runs fails here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const guard = join(
	dirname(fileURLToPath(import.meta.url)),
	"check-ci-coverage.mjs",
);
const roots = [];

after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function write(root, path, contents) {
	const full = join(root, path);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, contents);
}

// Three packages with a suite each: `collected` and `other` are picked up by
// test-parallel, `sharded` runs from a runner file inside itself, the way
// web-client does.
function fixture({ exclude = "sharded", shardStep = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), "ci-coverage-"));
	roots.push(root);
	write(
		root,
		"package.json",
		JSON.stringify({ scripts: { "test:ci": "node npm-scripts/run.mjs" } }),
	);
	write(root, "npm-scripts/lib/tooling.test.mjs", "");
	for (const name of ["collected", "other", "sharded"]) {
		write(
			root,
			`packages/${name}/package.json`,
			JSON.stringify({
				name: `@fixture/${name}`,
				scripts: { "test:run": "node --test src" },
			}),
		);
		write(root, `packages/${name}/src/unit.test.ts`, "");
	}
	write(
		root,
		"packages/sharded/scripts/shard.mjs",
		'spawn(process.execPath, ["--test", ...files]);\n',
	);
	write(
		root,
		".github/workflows/ci.yml",
		[
			"jobs:",
			"  test:",
			"    steps:",
			"      - name: Unit tests",
			"        env:",
			`          TEST_EXCLUDE: ${exclude}`,
			"        run: npm run test:ci",
			...(shardStep
				? ["      - run: node packages/sharded/scripts/shard.mjs"]
				: []),
			"",
		].join("\n"),
	);
	return root;
}

const check = (root) =>
	spawnSync(process.execPath, [guard, root], { encoding: "utf8" });

describe("check:ci-coverage seeding", () => {
	it("accepts a tree where every package runs by one route or the other", () => {
		const { status, stdout } = check(fixture());
		assert.equal(status, 0, stdout);
		assert.match(stdout, /TEST_EXCLUDE drops sharded/);
	});

	// The reproduction from #448: one more word in TEST_EXCLUDE deleted a
	// package's whole suite and the guard printed `CI coverage OK`.
	it("rejects a package TEST_EXCLUDE drops from the runner", () => {
		const { status, stderr } = check(fixture({ exclude: "sharded,collected" }));
		assert.equal(status, 1);
		assert.match(stderr, /"packages\/collected#test:run" runs nowhere/);
		assert.match(stderr, /TEST_EXCLUDE drops packages\/collected/);
	});

	// The other half: an excluded package must not be excused by the exclusion
	// itself, only by a runner CI actually reaches.
	it("rejects an excluded package once nothing invokes its runner", () => {
		const { status, stderr } = check(fixture({ shardStep: false }));
		assert.equal(status, 1);
		assert.match(stderr, /"packages\/sharded#test:run" runs nowhere/);
	});

	it("rejects an exclusion naming no workspace at all", () => {
		const { status, stderr } = check(fixture({ exclude: "sharded,typo" }));
		assert.equal(status, 1);
		assert.match(stderr, /TEST_EXCLUDE names "typo"/);
	});
});
