#!/usr/bin/env node
// Runs every suite under npm-scripts/, discovered rather than listed. The list
// this replaces was dropped by one merge conflict resolution (#160) and hand-
// restored by the next (#154), which is the argument against keeping one.
//
// Separate from the workspace runner because these suites import only node
// builtins, so they run in the install-free validate job and report in seconds.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverScriptSuites } from "./lib/test-suites.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const suites = await discoverScriptSuites(root);

console.log(
	`running ${suites.length} script suites:\n  ${suites.join("\n  ")}\n`,
);

const { status } = spawnSync("node", ["--test", ...suites], {
	cwd: root,
	stdio: "inherit",
});
process.exitCode = status ?? 1;
