#!/usr/bin/env node
/**
 * Fail codegen when the patch set in `patches/` is not present in
 * `node_modules/`. See `lib/patches-applied.mjs` for why an unpatched install
 * is otherwise silent.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findUnappliedPatches, readPatches } from "./lib/patches-applied.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patchDir = join(repoRoot, "patches");

const patches = await readPatches(patchDir);
if (patches.length === 0) {
	console.error(
		`No patches found in ${patchDir}. The patch set is an install input; an empty one means the tree is incomplete.`,
	);
	process.exit(1);
}

const readTarget = async (target) => {
	try {
		return await readFile(join(repoRoot, target), "utf8");
	} catch {
		return null;
	}
};

const findings = await findUnappliedPatches(patches, readTarget);
if (findings.length > 0) {
	console.error("Patches are not applied to node_modules:");
	for (const finding of findings) console.error(`  ${finding}`);
	console.error(
		"\nRun `npm ci` (its postinstall runs patch-package). If this is a container build, the stage that runs npm ci must also carry patches/.",
	);
	process.exit(1);
}

console.log(`patches: ${patches.length} applied`);
