#!/usr/bin/env node
// Proves every test script and test file in this repo is reached by CI. See
// lib/ci-coverage.mjs for what "reached" means and why the guard exists.
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageViolations } from "./lib/ci-coverage.mjs";
import { discoverScriptSuites } from "./lib/test-suites.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

const workflowFiles = await collectFiles(
	join(repoRoot, ".github"),
	(name) => name.endsWith(".yml") || name.endsWith(".yaml"),
);
const workflowSources = await Promise.all(
	workflowFiles.map((file) => readFile(join(repoRoot, file), "utf8")),
);

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
	workflowSources,
	testFiles: await collectFiles(repoRoot, (name) => name.endsWith(".test.mjs")),
	collectedFiles: await discoverScriptSuites(repoRoot),
	readFile: readSource,
	allowUnreachable: manifest.ciCoverage?.allowUnreachable ?? {},
});

if (violations.length > 0) {
	console.error("CI coverage violations:\n");
	for (const violation of violations) console.error(`  ${violation}`);
	console.error(
		"\nA suite or check that never runs reads as coverage and proves nothing.\n" +
			'A script that genuinely cannot run in CI goes in package.json under\n' +
			'"ciCoverage": { "allowUnreachable": { "<script>": "<why>" } }, which is\n' +
			"reviewable in the diff and fails once the reason stops holding.",
	);
	process.exit(1);
}

console.log(
	`CI coverage OK: ${workflowFiles.length} workflow files reach every test:*/check:* script, every suite is collected.`,
);
