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

// Two packages with a suite each, both picked up by test-parallel.
function fixture({
	extraScripts = {},
	packages = ["collected", "other"],
	testCommands = ["npm run test:ci"],
} = {}) {
	const root = mkdtempSync(join(tmpdir(), "ci-coverage-"));
	roots.push(root);
	write(
		root,
		"package.json",
		JSON.stringify({
			scripts: { "test:ci": "node npm-scripts/run.mjs", ...extraScripts },
		}),
	);
	write(root, "npm-scripts/lib/tooling.test.mjs", "");
	for (const name of packages) {
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
		".github/workflows/ci.yml",
		[
			"jobs:",
			"  test:",
			"    steps:",
			...testCommands.flatMap((command) => [
				"      - name: Unit tests",
				`        run: ${command}`,
			]),
			"",
		].join("\n"),
	);
	return root;
}

const check = (root) =>
	spawnSync(process.execPath, [guard, root], { encoding: "utf8" });

describe("check:ci-coverage seeding", () => {
	it("accepts a tree where the runner collects every package", () => {
		const { status, stdout } = check(fixture());
		assert.equal(status, 0, stdout);
		assert.match(stdout, /CI coverage OK/);
	});

	it("rejects a check script no workflow reaches", () => {
		const { status, stderr } = check(
			fixture({ extraScripts: { "check:orphan": "node orphan.mjs" } }),
		);
		assert.equal(status, 1);
		assert.match(stderr, /"check:orphan" is not reached by any workflow/);
	});

	const groups = (...names) =>
		names.map((name) => `npm run test:ci -- --group ${name}`);

	it("accepts groups that run every suite once", () => {
		const { status, stdout } = check(
			fixture({
				packages: ["mailbox-service", "other"],
				testCommands: groups("shared", "mailbox-service"),
			}),
		);
		assert.equal(status, 0, stdout);
	});

	it("rejects a suite that two groups run", () => {
		const { status, stderr } = check(
			fixture({
				packages: ["mailbox-service", "other"],
				testCommands: ["npm run test:ci", ...groups("mailbox-service")],
			}),
		);
		assert.equal(status, 1);
		assert.match(
			stderr,
			/suite "packages\/mailbox-service" runs in 2 test:ci jobs/,
		);
	});

	it("rejects a solo suite no group runs", () => {
		const { status, stderr } = check(
			fixture({
				packages: ["mailbox-service", "other"],
				testCommands: groups("shared"),
			}),
		);
		assert.equal(status, 1);
		assert.match(stderr, /"packages\/mailbox-service#test:run" is not reached/);
	});
});
