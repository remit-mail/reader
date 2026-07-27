// End-to-end cover for the exclusion backstop, which is the one route
// check:ci-coverage cannot see: an exclusion handed to the runner that no
// workflow file declares. `undeclaredExclusions` is unit-tested as a decision,
// and a decision nothing calls decides nothing — deleting the call site left
// every other suite green, which is the flaw this whole guard chain exists to
// close. Every case below runs the real runner against a fixture tree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const runner = join(
	dirname(fileURLToPath(import.meta.url)),
	"test-parallel.mjs",
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

// `sharded` is the package the fixture workflow declares as excluded;
// `collected` is a real package no workflow drops. Neither suite is meant to
// run: the fixture is not an installed npm project, so what these cases assert
// is which decisions the runner reaches, not what the suites report.
function fixture({ workflow = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), "test-parallel-"));
	roots.push(root);
	write(root, "package.json", JSON.stringify({ name: "fixture" }));
	for (const name of ["collected", "sharded"]) {
		write(
			root,
			`packages/${name}/package.json`,
			JSON.stringify({
				name: `@fixture/${name}`,
				scripts: { "test:run": "node -e ''" },
			}),
		);
		write(root, `packages/${name}/src/unit.test.ts`, "");
	}
	// No test files and no `test:run`, so discovery reports it as skipped — the
	// line that says the runner got past the check under test.
	write(
		root,
		"packages/notests/package.json",
		JSON.stringify({ name: "@fixture/notests" }),
	);
	if (workflow) {
		write(
			root,
			".github/workflows/ci.yml",
			[
				"jobs:",
				"  test:",
				"    steps:",
				"      - name: Unit tests",
				"        env:",
				"          TEST_EXCLUDE: sharded",
				"        run: npm run test:ci",
				"",
			].join("\n"),
		);
	}
	return root;
}

const run = (root, exclude) =>
	spawnSync(process.execPath, [runner, root], {
		encoding: "utf8",
		timeout: 120000,
		env: { ...process.env, TEST_EXCLUDE: exclude ?? "" },
	});

describe("test-parallel's exclusion backstop", () => {
	// Delete the call in test-parallel.mjs and this is the assertion that goes
	// red. The exit code alone would not: an unchecked run fails later anyway,
	// on the fixture not being an installed project.
	it("refuses an exclusion no workflow file declares", () => {
		const { status, stderr } = run(fixture(), "collected");
		assert.notEqual(status, 0);
		assert.match(stderr, /TEST_EXCLUDE drops collected/);
		assert.match(stderr, /which no workflow file declares/);
	});

	it("names only the undeclared half of a mixed list", () => {
		const { stderr } = run(fixture(), "sharded,collected");
		assert.match(stderr, /TEST_EXCLUDE drops collected/);
		assert.doesNotMatch(stderr, /drops sharded, collected/);
	});

	it("runs on past an exclusion the workflow declares", () => {
		const { stdout, stderr } = run(fixture(), "sharded");
		assert.doesNotMatch(stderr, /no workflow file declares/);
		assert.match(stdout, /no tests to run for: .*sharded \(excluded\)/);
	});

	it("excludes nothing and runs when TEST_EXCLUDE is unset", () => {
		const { stdout, stderr } = run(fixture());
		assert.doesNotMatch(stderr, /no workflow file declares/);
		assert.match(stdout, /no tests to run for: notests \(no tests\)/);
	});

	// A source tarball or a docker build context carries no workflows, and the
	// runner walks `.github` on every `test:ci`. Nothing to cross-check against
	// is not a reason to stop running the tests.
	it("runs in a tree that has no .github at all", () => {
		const { stdout, stderr } = run(fixture({ workflow: false }));
		assert.doesNotMatch(stderr, /ENOENT/);
		assert.match(stdout, /no tests to run for: notests \(no tests\)/);
	});
});
