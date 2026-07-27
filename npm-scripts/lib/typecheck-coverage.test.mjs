// Typecheck reachability guard (#440).
//
// `npm run typecheck` is `npm run test:typecheck --workspaces --if-present`, and
// the workspaces are `packages/*`. Being a package is therefore the whole gate:
// a `.ts` file anywhere else is compiled by nothing, and a hard type error in it
// reaches a released artifact with the gate still green. That is not
// hypothetical — the self-host migrator shipped two `TS2349`s and died at
// runtime after applying the schema migrations, because it lived under
// `deploy/` (#389).
//
// Widening one package's `include` to reach across the tree fixes one file and
// leaves the category open. This asserts the category instead: every TypeScript
// file the repository tracks is in the compilation of some package whose
// manifest declares `test:typecheck`.
//
// Failing here means one of two things. Either the file belongs to a package and
// that package's `tsconfig.json` does not reach it — widen the `include`. Or it
// has no owning package, in which case it is a package: give it a directory
// under `packages/`, a manifest with `test:typecheck`, and a `tsconfig.json`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES_DIR = join(ROOT, "packages");

const posix = (path) => path.split(sep).join("/");

// Tracked files only. Generated output (`build/`, `dist/`, the web-client route
// tree) is gitignored and is not what this guards — a file nobody committed
// cannot ship a type error nobody wrote.
const trackedTypeScript = () =>
	execFileSync("git", ["ls-files", "-z", "*.ts", "*.tsx"], {
		cwd: ROOT,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	})
		.split("\0")
		.filter(Boolean);

const packageDirs = () =>
	readdirSync(PACKAGES_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

const manifestOf = (name) => {
	const path = join(PACKAGES_DIR, name, "package.json");
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf8"));
};

// The configs a package's `test:typecheck` actually compiles. Reading them off
// the command rather than globbing `tsconfig*.json` is the point: a config no
// script runs covers nothing, and counting it would report a hole as covered.
const projectsOf = (script) => {
	const projects = [];
	for (const step of script.split("&&")) {
		if (!/\b(tsgo|tsc)\b/.test(step)) continue;
		const project = step.match(/\s(?:-p|--project)\s+(\S+)/);
		projects.push(project ? project[1] : "tsconfig.json");
	}
	return [...new Set(projects)];
};

// The file set a `tsconfig.json` actually compiles, `extends` and all — the same
// expansion `tsgo` performs, without typechecking anything.
const compiledFiles = (configPath) => {
	const host = {
		...ts.sys,
		onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
			throw new Error(
				`${configPath}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
			);
		},
	};
	const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
	assert.ok(parsed, `${configPath} could not be parsed`);
	return parsed.fileNames.map((file) => posix(relative(ROOT, file)));
};

describe("every tracked TypeScript file is under the typecheck gate", () => {
	const files = trackedTypeScript();

	it("finds TypeScript to check", () => {
		// Zero files means the walk broke, not that the repository stopped using
		// TypeScript. Reporting that as success is the failure this guards.
		assert.ok(files.length > 0, "git ls-files matched no TypeScript sources");
	});

	it("has no TypeScript outside packages/", () => {
		const stray = files.filter((file) => !file.startsWith("packages/"));
		assert.deepEqual(
			stray,
			[],
			"these files are in no workspace, so `npm run typecheck` never compiles them; each one is a package",
		);
	});

	it("compiles every one of them", () => {
		const covered = new Set();
		const unchecked = [];
		for (const name of packageDirs()) {
			const manifest = manifestOf(name);
			if (!manifest) continue;
			const script = manifest.scripts?.["test:typecheck"];
			if (!script) {
				unchecked.push(`packages/${name}`);
				continue;
			}
			for (const config of projectsOf(script)) {
				const configPath = join(PACKAGES_DIR, name, config);
				assert.ok(
					existsSync(configPath),
					`packages/${name} typechecks against ${config}, which does not exist`,
				);
				for (const file of compiledFiles(configPath)) covered.add(file);
			}
		}

		const missed = files.filter((file) => !covered.has(file));
		assert.deepEqual(
			missed,
			[],
			`not reached by any package's tsconfig (packages without a test:typecheck script: ${
				unchecked.join(", ") || "none"
			})`,
		);
	});
});
