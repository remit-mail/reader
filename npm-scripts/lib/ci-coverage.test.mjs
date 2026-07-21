import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	coverageViolations,
	invocations,
	reachable,
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
