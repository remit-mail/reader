#!/usr/bin/env node
// Proves `npm run typecheck` reaches every TypeScript file this repository
// tracks. See lib/typecheck-coverage.mjs for what "reaches" means and why the
// guard exists.
//
// This needs the workspace install: expanding a `tsconfig.json` the way the
// compiler does — `extends`, `include`, `files`, `exclude` — is the compiler's
// own job, and approximating it with a glob would be a second implementation to
// keep in step. So it runs as a `check:*` from a job that installs, not in the
// install-free suite.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
	projectsOf,
	strayFiles,
	uncoveredFiles,
	workspaceDirsFrom,
} from "./lib/typecheck-coverage.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The directories `npm run typecheck` enters, from the root manifest's own
// globs — the docs site is a workspace under `doc/`, not under `packages/`.
const childDirectories = (parent) => {
	const dir = join(ROOT, parent);
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
};

const rootManifest = JSON.parse(
	readFileSync(join(ROOT, "package.json"), "utf8"),
);
const workspaceDirs = workspaceDirsFrom(
	rootManifest.workspaces ?? [],
	childDirectories,
).sort();

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

// The file set a config actually compiles, `extends` and all — the same
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
	if (!parsed) throw new Error(`${configPath} could not be parsed`);
	return parsed.fileNames.map((file) => posix(relative(ROOT, file)));
};

const fail = (message, offenders) => {
	console.error(`typecheck coverage: ${message}`);
	for (const offender of offenders) console.error(`  ${offender}`);
	process.exit(1);
};

const files = trackedTypeScript();
// Zero files means the walk broke, not that the repository stopped using
// TypeScript. Reporting that as success is the failure this guards.
if (files.length === 0) {
	console.error("typecheck coverage: git ls-files matched no TypeScript");
	process.exit(1);
}

const stray = strayFiles(files, workspaceDirs);
if (stray.length > 0) {
	fail(
		`in no workspace, so \`npm run typecheck\` never compiles them. Each one is a package: give it a directory under one of ${rootManifest.workspaces.join(", ")}, a manifest with test:typecheck, and a tsconfig.json.`,
		stray,
	);
}

const covered = new Set();
const unchecked = [];
for (const workspace of workspaceDirs) {
	const manifestPath = join(ROOT, workspace, "package.json");
	if (!existsSync(manifestPath)) continue;
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const script = manifest.scripts?.["test:typecheck"];
	if (!script) {
		unchecked.push(workspace);
		continue;
	}
	for (const config of projectsOf(script)) {
		const configPath = join(ROOT, workspace, config);
		if (!existsSync(configPath)) {
			fail("named on a test:typecheck command but absent", [
				`${workspace}/${config}`,
			]);
		}
		for (const file of compiledFiles(configPath)) covered.add(file);
	}
}

const missed = uncoveredFiles(files, covered);
if (missed.length > 0) {
	fail(
		`reached by no config that a package's test:typecheck runs — widen that package's include, or name the config on the command. Packages with no test:typecheck at all: ${
			unchecked.join(", ") || "none"
		}.`,
		missed,
	);
}

console.log(
	`Typecheck coverage OK: ${files.length} tracked TypeScript files, every one compiled by a package's test:typecheck.`,
);
