// The e2e suite's location is written down twice — once in `e2e-suite.sh` as the
// path the install cds into, once in `test:e2e-unit` as the literal the
// reachability guard reads to learn which package that step runs. Moving the
// suite means changing both, and #445 moves it: `e2e` becomes `packages/e2e`.
//
// A half-applied move is silent in both directions. Change only the shell and
// the guard reports a suite nothing reaches (loud, harmless). Change only the
// manifest and `check:ci-coverage` still says OK while the step runs the wrong
// directory — a runtime break behind a green static check. These assertions are
// the thing that is not silent.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");
const rootManifest = JSON.parse(read("package.json"));
const step = rootManifest.scripts["test:e2e-unit"];

// Sourced rather than parsed, because sourcing is what the entry points do.
const shellValue = (name) =>
	execFileSync(
		"bash",
		["-c", `source npm-scripts/e2e-suite.sh && printf '%s' "\${${name}}"`],
		{ cwd: ROOT, encoding: "utf8" },
	);

describe("the e2e suite's location is one path, written twice", () => {
	it("resolves to a directory holding the suite's manifest", () => {
		const dir = shellValue("E2E_DIR");
		assert.ok(
			existsSync(join(dir, "package.json")),
			`e2e-suite.sh resolves E2E_DIR to ${dir}, which holds no package.json`,
		);
	});

	it("names the script test:e2e-unit runs", () => {
		const manifest = JSON.parse(
			readFileSync(join(shellValue("E2E_DIR"), "package.json"), "utf8"),
		);
		assert.ok(
			manifest.scripts?.["test:unit"],
			"the e2e manifest has no test:unit script for the CI step to run",
		);
	});

	it("agrees with the literal test:e2e-unit passes to --prefix", () => {
		const literal = step.match(/--prefix\s+(\S+)/)?.[1];
		assert.ok(literal, `test:e2e-unit passes no --prefix: ${step}`);
		assert.equal(
			literal,
			relative(ROOT, shellValue("E2E_DIR")),
			"the directory test:e2e-unit runs is not the one e2e-suite.sh installs",
		);
	});
});

// #445 makes the suite a workspace of the root project, at which point a bare
// `npm ci` in its directory installs the entire monorepo instead — npm walks up
// to the manifest that declares the workspace and takes that as the project. The
// install has to name its own project outright. Nothing about the failure is
// visible to the reachability guard, so it is asserted here.
describe("the e2e install names its own project", () => {
	const source = read("npm-scripts", "e2e-suite.sh");

	it("passes --prefix on every install it runs", () => {
		const installs = source.match(/^\s*npm (?:ci|install).*$/gm) ?? [];
		assert.ok(installs.length > 0, "e2e-suite.sh runs no install at all");
		for (const install of installs) {
			assert.match(install, /--prefix/, `install without --prefix: ${install}`);
		}
	});
});
