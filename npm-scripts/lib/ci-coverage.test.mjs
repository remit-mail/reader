import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	coverageViolations,
	invocations,
	reachable,
	runTarget,
	stripComments,
} from "./ci-coverage.mjs";

const noSuites = { testFiles: [], collectedFiles: [] };
const noFiles = () => null;

describe("invocations", () => {
	it("finds a script named by npm run", () => {
		const { scripts } = invocations("run: npm run lint");
		assert.deepEqual([...scripts], ["lint"]);
	});

	it("finds a file run directly by node", () => {
		const { files } = invocations("node npm-scripts/check-publish-closure.mjs");
		assert.deepEqual([...files], ["npm-scripts/check-publish-closure.mjs"]);
	});

	it("finds a file behind node flags", () => {
		const { files } = invocations("node --test npm-scripts/lib/a.test.mjs");
		assert.deepEqual([...files], ["npm-scripts/lib/a.test.mjs"]);
	});

	it("finds every file node --test is given, not just the first", () => {
		const { files } = invocations("node --test lib/a.test.mjs lib/b.test.mjs");
		assert.deepEqual([...files].sort(), ["lib/a.test.mjs", "lib/b.test.mjs"]);
	});

	it("finds a shell script run by bash", () => {
		const { files } = invocations("bash npm-scripts/release-tag.sh");
		assert.deepEqual([...files], ["npm-scripts/release-tag.sh"]);
	});

	it("normalises a leading ./", () => {
		const { files } = invocations("node ./npm-scripts/x.mjs");
		assert.deepEqual([...files], ["npm-scripts/x.mjs"]);
	});
});

describe("stripComments", () => {
	it("drops a whole-line yaml comment", () => {
		assert.equal(stripComments("# npm run images:publish", "yaml").trim(), "");
	});

	it("drops a trailing yaml comment but keeps the step", () => {
		const stripped = stripComments("run: npm run lint # npm run other", "yaml");
		assert.deepEqual([...invocations(stripped).scripts], ["lint"]);
	});

	it("drops line and block comments in a script", () => {
		const source = "// node a.mjs\n/* node b.mjs */\nnode c.mjs\n";
		const { files } = invocations(stripComments(source, "js"));
		assert.deepEqual([...files], ["c.mjs"]);
	});
});

describe("reachable", () => {
	it("follows a script into the file it runs", () => {
		const { reachedFiles } = reachable({
			scripts: { "check:x": "node npm-scripts/x.mjs" },
			workflowSources: ["npm run check:x"],
			readFile: noFiles,
		});
		assert.ok(reachedFiles.has("npm-scripts/x.mjs"));
	});

	it("follows a file into what that file shells out to", () => {
		const { reachedFiles } = reachable({
			scripts: { release: "node npm-scripts/publish.mjs" },
			workflowSources: ["npm run release"],
			readFile: (file) =>
				file === "npm-scripts/publish.mjs"
					? 'run("node", ["npm-scripts/check-publish-closure.mjs"])'
					: null,
		});
		assert.ok(reachedFiles.has("npm-scripts/check-publish-closure.mjs"));
	});

	it("terminates on a cycle between scripts", () => {
		const { reachedScripts } = reachable({
			scripts: { a: "npm run b", b: "npm run a" },
			workflowSources: ["npm run a"],
			readFile: noFiles,
		});
		assert.deepEqual([...reachedScripts].sort(), ["a", "b"]);
	});

	it("terminates on a cycle between files", () => {
		const { reachedFiles } = reachable({
			scripts: {},
			workflowSources: ["node a.mjs"],
			readFile: (file) => (file === "a.mjs" ? "node b.mjs" : "node a.mjs"),
		});
		assert.deepEqual([...reachedFiles].sort(), ["a.mjs", "b.mjs"]);
	});
});

describe("coverageViolations", () => {
	it("passes when every guarded script is named by a workflow", () => {
		const violations = coverageViolations({
			scripts: { "test:ci": "node runner.mjs", "check:patches": "node p.mjs" },
			workflowSources: ["npm run test:ci", "npm run check:patches"],
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});

	// The defect this guard shipped with: `release:dry-run` already ran the
	// publish checks as `node npm-scripts/*.mjs`, and reporting them unreached
	// caused redundant CI steps to be added.
	it("counts a script whose file another reached script runs", () => {
		const violations = coverageViolations({
			scripts: {
				"release:dry-run": "node npm-scripts/publish.mjs --dry-run",
				"check:publish-closure": "node npm-scripts/check-publish-closure.mjs",
			},
			workflowSources: ["npm run release:dry-run"],
			readFile: (file) =>
				file === "npm-scripts/publish.mjs"
					? 'run("node", ["npm-scripts/check-publish-closure.mjs"])'
					: null,
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});

	it("flags a test script no workflow reaches", () => {
		const violations = coverageViolations({
			scripts: { "test:ci": "node runner.mjs", "test:orphan": "node --test o" },
			workflowSources: ["npm run test:ci"],
			...noSuites,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /"test:orphan" is not reached/);
	});

	it("does not count a script named only in a workflow comment", () => {
		const violations = coverageViolations({
			scripts: { "check:closure": "node c.mjs" },
			workflowSources: ["# Drives npm run check:closure\nrun: npm run lint"],
			...noSuites,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /"check:closure" is not reached/);
	});

	it("ignores scripts outside the guarded prefixes", () => {
		const violations = coverageViolations({
			scripts: { format: "biome check --fix", "e2e:dev:up": "bash up.sh" },
			workflowSources: [],
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});

	it("flags a suite file no runner collects", () => {
		const violations = coverageViolations({
			scripts: {},
			workflowSources: [],
			testFiles: ["npm-scripts/lib/a.test.mjs", "x/stray.test.mjs"],
			collectedFiles: ["npm-scripts/lib/a.test.mjs"],
		});
		assert.equal(violations.length, 1);
		assert.match(
			violations[0],
			/"x\/stray\.test\.mjs" is collected by no runner/,
		);
	});

	it("accepts a suite that a reached script runs directly", () => {
		const violations = coverageViolations({
			scripts: { "release:dry-run": "node --test npm-scripts/lib/a.test.mjs" },
			workflowSources: ["npm run release:dry-run"],
			testFiles: ["npm-scripts/lib/a.test.mjs"],
			collectedFiles: [],
		});
		assert.deepEqual(violations, []);
	});

	it("allows an unreachable script with a stated reason", () => {
		const violations = coverageViolations({
			scripts: { "check:local": "node l.mjs" },
			workflowSources: [],
			allowUnreachable: { "check:local": "needs a GPU no runner has" },
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});

	it("rejects an allow-list entry with no reason", () => {
		const violations = coverageViolations({
			scripts: { "check:local": "node l.mjs" },
			workflowSources: [],
			allowUnreachable: { "check:local": "" },
			...noSuites,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /needs a reason/);
	});

	it("rejects an allow-list entry for a script CI does reach", () => {
		const violations = coverageViolations({
			scripts: { "check:x": "node x.mjs" },
			workflowSources: ["npm run check:x"],
			allowUnreachable: { "check:x": "stale" },
			...noSuites,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /CI reaches it: drop the entry/);
	});

	it("rejects an allow-list entry for a script that no longer exists", () => {
		const violations = coverageViolations({
			scripts: {},
			workflowSources: [],
			allowUnreachable: { "check:gone": "obsolete" },
			...noSuites,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /no longer exists/);
	});
});

// The hole this half closes: the e2e suite carried four tests behind `test:unit`
// that nothing ran, and the guard reported green because it read only the root
// manifest (#446).
const pkg = (dir, scripts, packageName) => ({ dir, packageName, scripts });

describe("coverageViolations across workspaces", () => {
	it("flags a workspace test script nothing reaches", () => {
		const violations = coverageViolations({
			scripts: {},
			workspaces: [pkg("packages/e2e", { "test:unit": "playwright test" })],
			workflowSources: [],
			...noSuites,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /"packages\/e2e#test:unit" is not reached/);
	});

	it("counts a workspace script a reached root script names with -w", () => {
		const violations = coverageViolations({
			scripts: { "test:e2e-unit": "npm run test:unit -w packages/e2e" },
			workspaces: [pkg("packages/e2e", { "test:unit": "playwright test" })],
			workflowSources: ["npm run test:e2e-unit"],
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});

	it("counts a workspace script named by --prefix", () => {
		const violations = coverageViolations({
			scripts: { "test:e2e-unit": "npm run test:unit --prefix e2e" },
			workspaces: [pkg("e2e", { "test:unit": "playwright test" })],
			workflowSources: ["npm run test:e2e-unit"],
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});

	it("counts a workspace named by its package name rather than its directory", () => {
		const violations = coverageViolations({
			scripts: { "test:x": "npm run test:unit -w @remit/e2e" },
			workspaces: [
				pkg("packages/e2e", { "test:unit": "playwright test" }, "@remit/e2e"),
			],
			workflowSources: ["npm run test:x"],
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});

	// The bug this replaced: reachability by bare name let one package's wiring
	// excuse every other package's script of the same name, so copying the
	// naming convention this guard introduced reopened #446.
	it("does not let one package's wiring reach another package's script", () => {
		const violations = coverageViolations({
			scripts: { "test:e2e-unit": "npm run test:unit --prefix e2e" },
			workspaces: [
				pkg("e2e", { "test:unit": "playwright test" }),
				pkg("packages/backend", { "test:unit": "node --test src/x.test.ts" }),
			],
			workflowSources: ["npm run test:e2e-unit"],
			...noSuites,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /"packages\/backend#test:unit" is not reached/);
	});

	// `npm run test:typecheck --workspaces --if-present` is how every package's
	// typecheck runs, and it names no package at all.
	it("counts a workspace script a --workspaces invocation names", () => {
		const violations = coverageViolations({
			scripts: { typecheck: "npm run test:typecheck --workspaces" },
			workspaces: [
				pkg("packages/a", { "test:typecheck": "tsgo --noEmit" }),
				pkg("packages/b", { "test:typecheck": "tsgo --noEmit" }),
			],
			workflowSources: ["npm run typecheck"],
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});

	// A second command on the same line must not lend its target to the first.
	it("does not carry a target across a shell separator", () => {
		const violations = coverageViolations({
			scripts: { "test:both": "npm run test:unit && npm run other -w b" },
			workspaces: [pkg("b", { "test:unit": "node --test", other: "true" })],
			workflowSources: ["npm run test:both"],
			...noSuites,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /"b#test:unit" is not reached/);
	});

	it("counts a workspace script the runner collects", () => {
		const violations = coverageViolations({
			scripts: {},
			workspaces: [pkg("packages/a", { "test:run": "node --test" })],
			workflowSources: [],
			collectedScripts: ["packages/a#test:run"],
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});

	it("follows a collected workspace script into its own further scripts", () => {
		const violations = coverageViolations({
			scripts: {},
			workspaces: [
				pkg("packages/a", {
					"test:run": "npm run test:run:pg && npm run test:run:sqlite",
					"test:run:pg": "node --test",
					"test:run:sqlite": "node --test",
				}),
			],
			workflowSources: [],
			collectedScripts: ["packages/a#test:run"],
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});

	// The same leak by another route: drizzle-service's dialect split must not
	// hand a free name to every other package.
	it("does not leak a package's own further scripts to other packages", () => {
		const violations = coverageViolations({
			scripts: {},
			workspaces: [
				pkg("packages/a", {
					"test:run": "npm run test:run:pg",
					"test:run:pg": "node --test",
				}),
				pkg("packages/b", {
					"test:run": "node --test",
					"test:run:pg": "node --test",
				}),
			],
			workflowSources: [],
			collectedScripts: ["packages/a#test:run", "packages/b#test:run"],
			...noSuites,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /"packages\/b#test:run:pg" is not reached/);
	});

	it("allows a workspace script with a stated reason", () => {
		const violations = coverageViolations({
			scripts: {},
			workspaces: [pkg("packages/a", { "test:integ": "node --test" })],
			workflowSources: [],
			allowUnreachable: {
				"packages/a#test:integ": "needs a Postgres no runner has",
			},
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});

	it("rejects a workspace allow-list entry for a script that no longer exists", () => {
		const violations = coverageViolations({
			scripts: {},
			workspaces: [pkg("packages/a", { "test:run": "node --test" })],
			workflowSources: [],
			collectedScripts: ["packages/a#test:run"],
			allowUnreachable: { "packages/a#test:gone": "obsolete" },
			...noSuites,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], /no longer exists/);
	});

	it("ignores a workspace script outside the guarded prefixes", () => {
		const violations = coverageViolations({
			scripts: {},
			workspaces: [pkg("packages/a", { build: "tsc", start: "node ." })],
			workflowSources: [],
			...noSuites,
		});
		assert.deepEqual(violations, []);
	});
});

describe("runTarget", () => {
	it("reads --workspaces as every package", () => {
		assert.equal(runTarget(" --workspaces --if-present"), "*");
	});

	it("reads -w, --workspace and --prefix as one package", () => {
		assert.equal(runTarget(" -w packages/a"), "packages/a");
		assert.equal(runTarget(" --workspace=packages/a"), "packages/a");
		assert.equal(runTarget(" --prefix e2e"), "e2e");
	});

	it("reads a bare invocation as the manifest it sits in", () => {
		assert.equal(runTarget(" --silent"), null);
	});

	it("stops at a shell separator", () => {
		assert.equal(runTarget(" && npm run other -w packages/a"), null);
	});
});
