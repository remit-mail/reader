/**
 * Codegen precondition: every patch in `patches/` is present in
 * `node_modules/`.
 *
 * patch-package is a postinstall step, and a postinstall step that finds no
 * patch directory succeeds — it has nothing to fail on. So an install that
 * never saw `patches/` is indistinguishable from a patched one until something
 * downstream reads the output. The generated enums are downstream: three of the
 * four patches fix string escaping in the emitters, so an unpatched install
 * emits `"\Seen"` where the TypeSpec declares `"\\Seen"`, which JavaScript then
 * parses as `Seen`. Every comparison against the IMAP wire silently stops
 * matching (#79).
 *
 * Checked before codegen rather than after, so the failure names the cause
 * instead of a symptom several generated files away.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const TARGET_PREFIX = "b/";

/**
 * The lines a patch adds, grouped by the file they are added to.
 *
 * Only added lines are used: they are the patch's post-image, so finding all
 * of them in the installed file means the patch is in place. Context and
 * removed lines say nothing on their own — context survives either way, and a
 * removed line's absence can have other causes.
 */
export const parsePatch = (diff) => {
	const byFile = new Map();
	let current;

	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) {
			const target = line.slice(4).trim();
			current = target.startsWith(TARGET_PREFIX)
				? target.slice(TARGET_PREFIX.length)
				: target;
			if (!byFile.has(current)) byFile.set(current, []);
			continue;
		}
		if (line.startsWith("--- ") || line.startsWith("+++")) continue;
		if (!current || !line.startsWith("+")) continue;

		const added = line.slice(1);
		if (added.trim() === "") continue;
		byFile.get(current).push(added);
	}

	return byFile;
};

/**
 * Patches whose post-image is missing from the tree, as human-readable
 * findings. Empty means every patch is applied.
 *
 * `readTarget` returns the installed file's contents, or null when it does not
 * exist — a patch targeting a package that was never installed is as much a
 * failure as an unapplied one, and reads as one.
 */
export const findUnappliedPatches = async (patches, readTarget) => {
	const findings = [];

	for (const { name, diff } of patches) {
		for (const [target, addedLines] of parsePatch(diff)) {
			const contents = await readTarget(target);
			if (contents === null) {
				findings.push(`${name}: ${target} is not installed`);
				continue;
			}
			const missing = addedLines.filter((line) => !contents.includes(line));
			if (missing.length > 0) {
				findings.push(`${name}: ${target} is missing the patched content`);
			}
		}
	}

	return findings;
};

export const readPatches = async (patchDir) => {
	let names;
	try {
		names = await readdir(patchDir);
	} catch {
		return [];
	}

	const patches = [];
	for (const name of names.filter((n) => n.endsWith(".patch")).sort()) {
		patches.push({ name, diff: await readFile(join(patchDir, name), "utf8") });
	}
	return patches;
};
