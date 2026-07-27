#!/usr/bin/env node
// Proves every test script and test file in this repo is reached by CI. See
// lib/ci-coverage.mjs for what "reached" means and why the guard exists.
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	coverageViolations,
	testExclusions,
	workspaceScriptId,
} from "./lib/ci-coverage.mjs";
import { discoverScriptSuites } from "./lib/test-suites.mjs";
import { readWorkflowSources } from "./lib/workflows.mjs";
import {
	discoverWorkspaces,
	WORKSPACE_SCRIPT,
	workspaceDir,
} from "./lib/workspace-suites.mjs";

// The tree to check, this repo unless a path is given. The guard's own suite
// points it at fixture trees: the seeding done here is where #448 lived, not in
// the decisions lib/ci-coverage.mjs makes, so it has to be exercised end to end.
const repoRoot = resolve(
	process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
);
const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"dist-docker",
]);

async function collectFiles(dir, matches) {
	const found = [];
	const walk = async (current) => {
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch (error) {
			if (error.code === "ENOENT") return;
			throw error;
		}
		for (const entry of entries) {
			if (IGNORED_DIRS.has(entry.name)) continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (matches(entry.name)) found.push(relative(repoRoot, full));
		}
	};
	await walk(dir);
	return found.sort();
}

const manifest = JSON.parse(
	await readFile(join(repoRoot, "package.json"), "utf8"),
);

// Every manifest in the tree except the root's. A test script is guarded
// wherever it lives, so which directories happen to be npm workspaces today is
// not the question — `e2e` is its own project and its suite still has to run.
// The package name rides along because an invocation may name a package either
// way: `npm run generate:routes -w @remit/web-client` and `-w packages/web-client`
// reach the same scripts.
async function collectWorkspaces() {
	const manifests = await collectFiles(
		repoRoot,
		(name) => name === "package.json",
	);
	const found = [];
	for (const file of manifests) {
		if (file === "package.json") continue;
		const parsed = JSON.parse(await readFile(join(repoRoot, file), "utf8"));
		if (!parsed.scripts) continue;
		found.push({
			dir: dirname(file),
			packageName: parsed.name,
			scripts: parsed.scripts,
		});
	}
	return found;
}

const { files: workflowFiles, sources: workflowSources } =
	await readWorkflowSources(repoRoot);

// What the runner behind `test:ci` executes in CI, asked of the runner with the
// arguments CI hands it. Asking the runner rather than asserting the workflow's
// shape keeps the guard honest about which packages it picks up; passing the
// workflow's own `TEST_EXCLUDE` keeps it honest about which ones it drops.
// `discoverWorkspaces` rejects a name matching no workspace, so a typo in the
// list fails here rather than silently excluding nothing.
const exclude = testExclusions(workflowSources);
const { suites } = await discoverWorkspaces(repoRoot, { exclude });

// Only files the repo tracks are followed; a path a script builds at runtime, or
// one outside the tree, simply reaches nothing further.
const readSource = (file) => {
	try {
		return readFileSync(join(repoRoot, file), "utf8");
	} catch {
		return null;
	}
};

const violations = coverageViolations({
	scripts: manifest.scripts ?? {},
	workspaces: await collectWorkspaces(),
	workflowSources,
	testFiles: await collectFiles(repoRoot, (name) => name.endsWith(".test.mjs")),
	collectedFiles: await discoverScriptSuites(repoRoot),
	collectedScripts: suites.map((suite) =>
		workspaceScriptId(suite.workspace, WORKSPACE_SCRIPT),
	),
	excludedWorkspaces: exclude.map(workspaceDir),
	readFile: readSource,
	allowUnreachable: manifest.ciCoverage?.allowUnreachable ?? {},
});

if (violations.length > 0) {
	console.error("CI coverage violations:\n");
	for (const violation of violations) console.error(`  ${violation}`);
	console.error(
		"\nA suite or check that never runs reads as coverage and proves nothing.\n" +
			"A script that genuinely cannot run in CI goes in package.json under\n" +
			'"ciCoverage": { "allowUnreachable": { "<script>": "<why>" } }, which is\n' +
			"reviewable in the diff and fails once the reason stops holding.",
	);
	process.exit(1);
}

const dropped =
	exclude.length > 0
		? ` TEST_EXCLUDE drops ${exclude.join(", ")} from test:ci, each run by a runner CI reaches instead.`
		: "";

console.log(
	`CI coverage OK: ${workflowFiles.length} workflow files reach every test:*/check:* script in the root manifest and in every workspace, every suite is collected.${dropped}`,
);
