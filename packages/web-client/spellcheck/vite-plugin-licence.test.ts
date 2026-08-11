/**
 * A dictionary whose licence text cannot travel with it must stop the build.
 *
 * Every licence in the table obliges the text to ship alongside the files, and
 * the build generates NOTICE.txt from the same rows — so a package that lost its
 * licence file (an upstream repackage, a pruned install) would otherwise produce
 * an image whose notice points at a `LICENSE` nobody staged. That is the one
 * failure mode a reader cannot see and a distributor is answerable for.
 *
 * The dictionary is shadowed rather than the real one damaged: node resolves
 * from the importer outwards, so a package planted in this directory's own
 * `node_modules` answers for `dictionary-en-gb` here and nowhere else. That
 * makes this file its own process — node's test runner gives each file one —
 * because module resolution is cached per process and a sibling test resolving
 * the real package first would decide which one this sees.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const shadowRoot = join(import.meta.dirname, "node_modules");
const shadow = join(shadowRoot, "dictionary-en-gb");
mkdirSync(shadow, { recursive: true });
writeFileSync(
	join(shadow, "package.json"),
	JSON.stringify({ name: "dictionary-en-gb", version: "0.0.0-shadow" }),
);
writeFileSync(join(shadow, "index.js"), "");
writeFileSync(join(shadow, "index.aff"), "SET UTF-8\n");
writeFileSync(join(shadow, "index.dic"), "1\nword\n");

const engineDir = mkdtempSync(join(tmpdir(), "spellcheck-engine-"));
for (const name of [
	"hunspell.wasm",
	"hunspell.mjs",
	"LICENSE",
	"license.hunspell",
]) {
	writeFileSync(join(engineDir, name), "stub");
}
process.env.REMIT_SPELLCHECK_ENGINE_DIR = engineDir;

const { stageSpellcheck } = await import("./vite-plugin.ts");

after(() => {
	rmSync(shadow, { recursive: true, force: true });
	rmSync(shadowRoot, { recursive: true, force: true });
	rmSync(engineDir, { recursive: true, force: true });
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
