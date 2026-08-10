// End-to-end cover for the exclusion backstop, which is the one route
// check:ci-coverage cannot see: an exclusion handed to the runner that no
// workflow file declares. `undeclaredExclusions` is unit-tested as a decision,
// and a decision nothing calls decides nothing — deleting the call site left
// every other suite green, which is the flaw this whole guard chain exists to
// close. Every case below runs the real runner against a fixture tree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
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

// A real workspace root this time, so `npm run test:run -w ...` reaches the
// script and the suite genuinely runs. It needs no install: the script it runs
// is node itself.
function hangingFixture() {
	const root = mkdtempSync(join(tmpdir(), "test-parallel-hang-"));
	roots.push(root);
	write(
		root,
		"package.json",
		JSON.stringify({ name: "fixture", workspaces: ["packages/*"] }),
	);
	write(
		root,
		"packages/hangs/package.json",
		JSON.stringify({
			name: "@fixture/hangs",
			scripts: { "test:run": "node hang.mjs" },
		}),
	);
	write(root, "packages/hangs/src/unit.test.ts", "");
	// Every test passes and the process still never exits, which is the shape
	// this is about: a handle left open outlives a green suite.
	write(
		root,
		"packages/hangs/hang.mjs",
		[
			'import { writeFileSync } from "node:fs";',
			"writeFileSync(process.env.HANG_PID_FILE, String(process.pid));",
			'console.log("all tests passed");',
			"setInterval(() => {}, 1000);",
			"",
		].join("\n"),
	);
	return root;
}

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

// Two CI jobs were killed by their runner host on a suite whose tests had all
// passed and whose process then never exited. Nothing said which suite: the run
// waited on it until the host gave up, and the log carried a bare SIGTERM.
describe("test-parallel against a suite that never exits", () => {
	let pidFile;
	let result;

	before(() => {
		const root = hangingFixture();
		pidFile = join(root, "hang.pid");
		result = spawnSync(process.execPath, [runner, root], {
			encoding: "utf8",
			timeout: 120000,
			env: {
				...process.env,
				TEST_EXCLUDE: "",
				HANG_PID_FILE: pidFile,
				TEST_SUITE_TIMEOUT_MS: "4000",
			},
		});
	});

	it("ends the run itself rather than waiting on the suite", () => {
		assert.equal(result.signal, null);
		assert.equal(result.status, 1);
	});

	it("names the suite it was inside, on the way in and on the way out", () => {
		assert.match(result.stdout, /RUN hangs/);
		assert.match(result.stdout, /HANG hangs/);
		assert.match(result.stdout, /failing suites: hangs/);
		assert.match(result.stdout, /look for a handle the suite leaves open/);
	});

	// The suite is npm's child, so killing the child alone leaves this process
	// running with the pipes open — the orphan the CI runner had to terminate
	// after the job it belonged to was already over.
	it("leaves nothing of the suite behind", () => {
		const pid = Number(readFileSync(pidFile, "utf8"));
		assert.ok(Number.isInteger(pid) && pid > 0);
		assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
	});
});
