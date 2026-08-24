/**
 * A dictionary whose licence text cannot travel with it must stop the build.
 *
 * Every licence in the table obliges the text to ship alongside the files, and
 * the build generates NOTICE.txt from the same rows — so a package that lost its
 * licence file (an upstream repackage, a pruned install) would otherwise produce
 * an image whose notice points at a `LICENSE` nobody staged. That is the one
 * failure mode a reader cannot see and a distributor is answerable for.
 *
 * The dictionary is shadowed inside this test's own temporary tree rather than
 * anywhere on the shared resolution path: the plugin sources are copied in
 * beside a private `node_modules`, so `require.resolve` from that copy answers
 * for the shadow and nowhere else. Planting into `spellcheck/node_modules`
 * instead would be visible to every other test file — node's runner isolates
 * the module cache per process, never the filesystem, and runs files
 * concurrently.
 */

import assert from "node:assert/strict";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

const here = import.meta.dirname;
const tmpRoot = mkdtempSync(join(tmpdir(), "spellcheck-licence-"));

// The plugin under test, imported from inside the temporary tree so its
// package resolution starts at the tree's own `node_modules`.
const src = join(tmpRoot, "spellcheck");
const engineDir = join(tmpRoot, "engine");
mkdirSync(src, { recursive: true });
for (const name of ["vite-plugin.ts", "languages.ts"]) {
	copyFileSync(join(here, name), join(src, name));
}

// A licence-less shadow of `dictionary-en-gb`, plus the real `dictionary-en`
// copied across for the case that does stage a licence.
const modules = join(tmpRoot, "node_modules");
const real = (name: string) =>
	dirname(createRequire(import.meta.url).resolve(name));
const shadow = join(modules, "dictionary-en-gb");
mkdirSync(shadow, { recursive: true });
writeFileSync(
	join(shadow, "package.json"),
	JSON.stringify({ name: "dictionary-en-gb", version: "0.0.0-shadow" }),
);
writeFileSync(join(shadow, "index.js"), "");
writeFileSync(join(shadow, "index.aff"), "SET UTF-8\n");
writeFileSync(join(shadow, "index.dic"), "1\nword\n");
const realEn = real("dictionary-en");
const stagedEn = join(modules, "dictionary-en");
mkdirSync(stagedEn, { recursive: true });
for (const entry of [
	"package.json",
	"index.js",
	"index.aff",
	"index.dic",
] as const) {
	copyFileSync(join(realEn, entry), join(stagedEn, entry));
}
// The licence text under whatever name upstream ships it.
const licenceFile = readdirSync(realEn).find((entry) =>
	/^licen[cs]e/i.test(entry),
);
assert.ok(licenceFile);
copyFileSync(join(realEn, licenceFile), join(stagedEn, licenceFile));

// Pins read from beside the engine; the stub carries its own.
mkdirSync(engineDir, { recursive: true });
for (const name of [
	"hunspell.wasm",
	"hunspell.mjs",
	"LICENSE",
	"license.hunspell",
]) {
	writeFileSync(join(engineDir, name), "stub");
}
writeFileSync(
	join(engineDir, "pin.env"),
	["HUNSPELL_VERSION=0.0.0-test", "HUNSPELL_SHA256=test"].join("\n"),
);
process.env.REMIT_SPELLCHECK_ENGINE_DIR = engineDir;

const { stageSpellcheck } = await import(
	join(src, "vite-plugin.ts").replace("file://", "")
);

after(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("a dictionary that ships no licence text", () => {
	it("stops the build rather than staging it", () => {
		assert.throws(() => stageSpellcheck("en-GB", "/"));
	});

	// The remedy is the whole message: which directory, and why a missing
	// licence file is fatal rather than something the notice can paper over.
	it("names the directory and what is wrong with it", () => {
		assert.throws(
			() => stageSpellcheck("en-GB", "/"),
			(failed: Error) => {
				assert.ok(
					failed.message.includes(shadow),
					`the failure does not name the dictionary directory: ${failed.message}`,
				);
				assert.match(failed.message, /licence/i);
				assert.match(failed.message, /NOTICE\.txt/);
				return true;
			},
		);
	});

	// The languages before the broken one must not reach the output either: a
	// half-staged tree with a complete-looking notice is worse than no build.
	it("takes the whole build with it, not just that language", () => {
		assert.throws(() => stageSpellcheck("en,en-GB", "/"));
	});
});

describe("a dictionary that does ship one", () => {
	it("stages the licence text beside the files it covers", () => {
		const build = stageSpellcheck("en", "/");
		const licence = build.files.find(
			(file) => file.path === "dictionaries/en/LICENSE",
		);
		assert.ok(licence);
		assert.ok(licence.source.byteLength > 0);
	});
});
