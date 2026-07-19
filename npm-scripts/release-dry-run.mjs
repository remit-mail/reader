#!/usr/bin/env node
// Dry run of the publish pipeline: consume any pending changesets to compute the
// versions that would ship, then pack every intended package so the tarball set
// and its contents are visible on the PR without touching the registry. The
// working tree is left mutated; run it on a throwaway checkout (CI) or discard
// the changes afterwards.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args) =>
	execFileSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });
const capture = (cmd, args) =>
	execFileSync(cmd, args, { cwd: repoRoot, encoding: "utf8" });

const config = JSON.parse(
	readFileSync(join(repoRoot, ".changeset", "config.json"), "utf8"),
);
const ignored = new Set(config.ignore ?? []);

const workspaceDirs = readdirSync(join(repoRoot, "packages")).map((name) =>
	join("packages", name),
);

const intended = [];
for (const dir of workspaceDirs) {
	let manifest;
	try {
		manifest = JSON.parse(
			readFileSync(join(repoRoot, dir, "package.json"), "utf8"),
		);
	} catch {
		continue;
	}
	if (manifest.private) continue;
	if (ignored.has(manifest.name)) continue;
	intended.push(manifest.name);
}

console.log("Checking publish closure...\n");
run("node", ["npm-scripts/check-publish-closure.mjs"]);

console.log("\nPending release plan:\n");
try {
	run("npx", ["changeset", "status", "--verbose"]);
} catch {
	console.log("(no pending changesets)\n");
}

console.log("\nApplying version bumps (changeset version)...\n");
run("npx", ["changeset", "version"]);

console.log(`\nPacking ${intended.length} intended packages:\n`);
for (const name of intended) {
	const out = capture("npm", [
		"pack",
		"--dry-run",
		"--json",
		"--workspace",
		name,
	]);
	const [{ id, filename, files }] = JSON.parse(out);
	console.log(`  ${id}  ->  ${filename}  (${files.length} files)`);
}
