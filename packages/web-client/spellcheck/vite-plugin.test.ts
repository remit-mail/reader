/**
 * What the build stages, and whether NOTICE.txt describes it.
 *
 * The licence obligation this repo took on is that the notice matches the image
 * exactly and that the served dictionary is the upstream file — which is the
 * whole reason the language set is fixed at build time rather than chosen at
 * run time. A notice that names a dictionary the image does not carry, or omits
 * one it does, is a licence failure and not a cosmetic one, so the chain from
 * the resolved set through the manifest to the notice is asserted end to end
 * rather than at either end.
 *
 * This runs in the checkout, against the dictionary packages actually
 * installed, which is what makes the byte-for-byte and licence-text assertions
 * mean anything. `npm-scripts/lib/spellcheck-staging.test.mjs` is the other
 * half: the same function against a synthetic tree shaped like the published
 * package, where the question is which file gets read and what a distributor is
 * told when one is missing. Base, `servePath` and the digest belong to that
 * one.
 *
 * The engine is stubbed: what it weighs is gated where it is built
 * (npm-scripts/build-hunspell.mjs), and staging it here would make every one of
 * these tests wait on a WebAssembly toolchain.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);

const ENGINE_FILES = {
	"hunspell.wasm": "\0asm stub",
	"hunspell.mjs": "export default () => {};",
	LICENSE: "Mozilla Public Licence 1.1, stub",
	"license.hunspell": "Hunspell licence, stub",
};

const engineDir = mkdtempSync(join(tmpdir(), "spellcheck-engine-"));
for (const [name, body] of Object.entries(ENGINE_FILES)) {
	writeFileSync(join(engineDir, name), body);
}

process.env.REMIT_SPELLCHECK_ENGINE_DIR = engineDir;
const { stageSpellcheck } = await import("./vite-plugin.ts");

const staged = (requested: string) => stageSpellcheck(requested, "/");

const fileNamed = (
	build: ReturnType<typeof staged>,
	path: string,
): Buffer | undefined => build.files.find((file) => file.path === path)?.source;

const textOf = (build: ReturnType<typeof staged>, path: string): string => {
	const found = fileNamed(build, path);
	if (!found) throw new Error(`${path} was not staged`);
	return found.toString("utf8");
};

/** The tags NOTICE.txt claims this image carries, read back off the notice. */
const tagsNoticed = (notice: string): readonly string[] => {
	const dictionaries = notice.split("\nDictionaries\n")[1];
	if (dictionaries === undefined) {
		throw new Error("NOTICE.txt has no Dictionaries section");
	}
	return dictionaries
		.split("\n")
		.map((line) => /^(\S+) — /.exec(line)?.[1])
		.filter((tag): tag is string => tag !== undefined);
};

/** The tags the image actually carries a dictionary for. */
const tagsStaged = (build: ReturnType<typeof staged>): readonly string[] => [
	...new Set(
		build.files
			.map((file) => /^dictionaries\/([^/]+)\//.exec(file.path)?.[1])
			.filter((tag): tag is string => tag !== undefined),
	),
];

describe("what a build stages", () => {
	it("stages the engine, both dictionary files and a licence per language", () => {
		const build = staged("en,nl");
		const paths = build.files.map((file) => file.path).sort();
		assert.deepEqual(paths, [
			"LICENSE",
			"NOTICE.txt",
			"dictionaries/en/LICENSE",
			"dictionaries/en/index.aff",
			"dictionaries/en/index.dic",
			"dictionaries/nl/LICENSE",
			"dictionaries/nl/index.aff",
			"dictionaries/nl/index.dic",
			"hunspell.mjs",
			"hunspell.wasm",
			"license.hunspell",
			"manifest.json",
		]);
	});

	// GPL and MPL correspondence is discharged by the served file being the
	// upstream one. Anything that rewrote a dictionary on the way through —
	// a normaliser, a re-encode, a line-ending fix — would break that quietly.
	it("serves the upstream dictionary byte for byte", () => {
		const build = staged("nl");
		const upstream = dirname(require.resolve("dictionary-nl"));
		for (const name of ["index.aff", "index.dic"]) {
			assert.deepEqual(
				fileNamed(build, `dictionaries/nl/${name}`),
				readFileSync(join(upstream, name)),
				`dictionaries/nl/${name} is not the upstream file`,
			);
		}
	});
});

describe("NOTICE.txt", () => {
	it("names every language the image carries", () => {
		const build = staged("en,en-GB,nl");
		const noticed = tagsNoticed(textOf(build, "NOTICE.txt"));
		assert.deepEqual([...noticed].sort(), ["en", "en-GB", "nl"]);
	});

	// Over-claiming is the failure that matters: a notice listing a dictionary
	// the image does not carry offers a licence text nobody can find, and one
	// missing a dictionary it does carry ships that dictionary with no licence
	// at all. Both are the same defect from opposite sides, so the three lists
	// the build produces are compared to each other rather than to a fixture.
	it("names only the languages the image carries", () => {
		for (const requested of ["en", "nl", "en,en-GB,nl"]) {
			const build = staged(requested);
			const notice = textOf(build, "NOTICE.txt");
			const carried = tagsStaged(build);
			const manifest = JSON.parse(textOf(build, "manifest.json"));

			assert.deepEqual(
				[...tagsNoticed(notice)].sort(),
				[...carried].sort(),
				`NOTICE.txt and the staged dictionaries disagree for "${requested}"`,
			);
			assert.deepEqual(
				manifest.languages.map((language: { tag: string }) => language.tag),
				build.languages.map((language) => language.tag),
			);
			assert.deepEqual(
				[...carried].sort(),
				build.languages.map((language) => language.tag).sort(),
			);
		}
	});

	it("points every language at a licence text the image ships", () => {
		const build = staged("en,en-GB,nl");
		const notice = textOf(build, "NOTICE.txt");
		const referenced = [...notice.matchAll(/Licence text: (\S+?),/g)]
			.map((match) => match[1])
			.sort();
		assert.deepEqual(referenced, [
			"LICENSE",
			"dictionaries/en-GB/LICENSE",
			"dictionaries/en/LICENSE",
			"dictionaries/nl/LICENSE",
		]);
		for (const path of referenced) {
			const licence = fileNamed(build, path);
			assert.ok(licence, `NOTICE.txt names ${path}, which is not staged`);
			assert.ok(licence.byteLength > 0, `${path} is empty`);
		}
	});

	it("states each licence, its author and the version that was staged", () => {
		const build = staged("nl");
		const notice = textOf(build, "NOTICE.txt");
		const [dutch] = build.languages.filter((language) => language.tag === "nl");
		assert.match(notice, /nl — OpenTaal/);
		assert.ok(notice.includes(`Licence: ${dutch.licence}`));
		assert.ok(notice.includes(`Authors: ${dutch.authors}`));
		assert.ok(notice.includes(`dictionary-nl@${dutch.version}`));
		assert.match(dutch.version, /^\d+\.\d+\.\d+/);
	});

	it("says the served files are the source where a licence requires it", () => {
		const gpl = textOf(staged("nl,en"), "NOTICE.txt");
		// Neither English nor Dutch is under a correspondence licence here, so
		// the sentence must not appear; German would bring it.
		assert.ok(!gpl.includes("unmodified upstream source"));
	});

	it("carries the engine's own provenance, checksum included", () => {
		const notice = textOf(staged("en"), "NOTICE.txt");
		const pins = readFileSync(
			join(
				import.meta.dirname,
				"..",
				"..",
				"..",
				"docker",
				"hunspell",
				"pin.env",
			),
			"utf8",
		);
		const version = /HUNSPELL_VERSION=(\S+)/.exec(pins)?.[1];
		const sha = /HUNSPELL_SHA256=(\S+)/.exec(pins)?.[1];
		assert.ok(version && sha);
		assert.ok(notice.includes(`Hunspell ${version}`));
		assert.ok(notice.includes(sha));
	});
});

describe("the manifest the app reads", () => {
	it("describes the engine and every language it staged", () => {
		const build = staged("en,nl");
		const manifest = JSON.parse(textOf(build, "manifest.json"));
		assert.equal(manifest.engine.project, "Hunspell");
		assert.equal(manifest.engine.licence, "MPL-1.1");
		assert.deepEqual(
			manifest.languages.map(
				(language: { licenceFile: string }) => language.licenceFile,
			),
			["dictionaries/en/LICENSE", "dictionaries/nl/LICENSE"],
		);
		for (const language of manifest.languages) {
			assert.ok(fileNamed(build, language.licenceFile));
			assert.match(language.package, /@\d+\.\d+\.\d+/);
		}
	});
});
