/**
 * Turns `REMIT_SPELLCHECK_LANGUAGES` into what the browser fetches: the engine,
 * one directory per language holding the upstream `.aff`, `.dic` and licence
 * text byte for byte, a manifest, and the notice generated from it.
 *
 * Nothing here is bundled and nothing is fetched at page load. The build's own
 * job is that the notice describes the image exactly — which is the reason the
 * language set is fixed at build time at all — so a tag nobody can ship, or a
 * dictionary whose licence file is missing, fails the build by name.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { DictionarySource } from "./languages.ts";
import { resolveLanguages } from "./languages.ts";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const engineDir = join(repoRoot, "build", "hunspell");

const LICENCE_NAMES = ["LICENSE", "license", "LICENCE", "licence"];

interface StagedFile {
	readonly path: string;
	readonly source: Buffer;
}

interface StagedLanguage extends DictionarySource {
	readonly version: string;
	readonly files: readonly StagedFile[];
}

const readPin = (name: string): string => {
	const pins = readFileSync(
		join(repoRoot, "docker", "build", "hunspell", "pin.env"),
		"utf8",
	);
	const found = new RegExp(`^${name}=(.*)$`, "m").exec(pins);
	if (!found) throw new Error(`docker/build/hunspell/pin.env has no ${name}`);
	return found[1];
};

const licenceIn = (directory: string): string => {
	const named = LICENCE_NAMES.find((name) => existsSync(join(directory, name)));
	if (named) return named;
	const found = readdirSync(directory).find((entry) =>
		/^licen[cs]e/i.test(entry),
	);
	if (found) return found;
	throw new Error(
		`${directory} ships no licence file. A dictionary whose licence text cannot travel with it cannot ship, so the build stops here rather than producing a NOTICE.txt that claims one exists.`,
	);
};

const stageEngine = (): StagedFile[] => {
	const wasm = join(engineDir, "hunspell.wasm");
	if (!existsSync(wasm)) {
		throw new Error(
			`${wasm} is missing. Build the spellchecker engine first: npm run build:hunspell (it runs docker/build/hunspell/build.sh in the pinned Emscripten image). Set REMIT_SPELLCHECK_LANGUAGES= to build without a spellchecker.`,
		);
	}
	return [
		{ path: "hunspell.wasm", source: readFileSync(wasm) },
		{
			path: "hunspell.mjs",
			source: readFileSync(join(engineDir, "hunspell.mjs")),
		},
		{ path: "LICENSE", source: readFileSync(join(engineDir, "LICENSE")) },
		{
			path: "license.hunspell",
			source: readFileSync(join(engineDir, "license.hunspell")),
		},
	];
};

const stageLanguage = (source: DictionarySource): StagedLanguage => {
	const manifest = require.resolve(`${source.package}/package.json`);
	const directory = dirname(manifest);
	const version = JSON.parse(readFileSync(manifest, "utf8")).version;
	const licence = licenceIn(directory);
	const at = (name: string) => `dictionaries/${source.tag}/${name}`;
	return {
		...source,
		version,
		files: [
			{
				path: at("index.aff"),
				source: readFileSync(join(directory, "index.aff")),
			},
			{
				path: at("index.dic"),
				source: readFileSync(join(directory, "index.dic")),
			},
			{ path: at("LICENSE"), source: readFileSync(join(directory, licence)) },
		],
	};
};

/** A licence that says the served form must be the source says it out loud. */
const correspondence = (licence: string): boolean =>
	/GPL|MPL/.test(licence.toUpperCase());

const noticeFor = (
	engineVersion: string,
	languages: readonly StagedLanguage[],
): string => {
	const blocks = languages.map((language) =>
		[
			`${language.tag} — ${language.project}`,
			`  Authors: ${language.authors}`,
			`  Source: ${language.source}`,
			`  Package: ${language.package}@${language.version}`,
			`  Licence: ${language.licence}`,
			`  Licence text: spellcheck/dictionaries/${language.tag}/LICENSE`,
			...(correspondence(language.licence)
				? [
						`  The served index.aff and index.dic are the unmodified upstream source.`,
					]
				: []),
		].join("\n"),
	);
	return [
		"This build of Remit Reader carries the spelling dictionaries listed below.",
		"Each stays under its own licence; the licence text travels with the files,",
		"and nothing in this image modifies a dictionary. Reader itself is MIT.",
		"",
		"Engine",
		"",
		`  Hunspell ${engineVersion}`,
		"  Source: https://github.com/hunspell/hunspell",
		`  Tarball: https://github.com/hunspell/hunspell/releases/download/v${engineVersion}/hunspell-${engineVersion}.tar.gz`,
		`  sha256: ${readPin("HUNSPELL_SHA256")}`,
		"  Licence: MPL-1.1 (the option taken from Hunspell's MPL-1.1/GPL-2.0/LGPL-2.1 triple)",
		"  Licence text: spellcheck/LICENSE",
		"  Build recipe: docker/build/hunspell/build.sh",
		"",
		"Dictionaries",
		"",
		...blocks.map((block) => `${block}\n`),
	].join("\n");
};

export interface SpellcheckBuild {
	readonly languages: readonly StagedLanguage[];
	readonly files: readonly StagedFile[];
	readonly base: string;
}

export const stageSpellcheck = (
	requested: string | undefined,
	base: string,
): SpellcheckBuild => {
	const wanted = resolveLanguages(requested);
	if (wanted.length === 0) return { languages: [], files: [], base };

	const engineVersion = readPin("HUNSPELL_VERSION");
	const languages = wanted.map(stageLanguage);
	const manifest = {
		engine: {
			project: "Hunspell",
			version: engineVersion,
			licence: "MPL-1.1",
			source: "https://github.com/hunspell/hunspell",
			recipe: "docker/build/hunspell/build.sh",
		},
		languages: languages.map((language) => ({
			tag: language.tag,
			project: language.project,
			authors: language.authors,
			source: language.source,
			package: `${language.package}@${language.version}`,
			licence: language.licence,
			licenceFile: `dictionaries/${language.tag}/LICENSE`,
		})),
	};

	return {
		languages,
		base,
		files: [
			...stageEngine(),
			...languages.flatMap((language) => language.files),
			{
				path: "manifest.json",
				source: Buffer.from(`${JSON.stringify(manifest, null, "\t")}\n`),
			},
			{
				path: "NOTICE.txt",
				source: Buffer.from(noticeFor(engineVersion, languages)),
			},
		],
	};
};

export const spellcheckPlugin = (): Plugin => {
	let staged: SpellcheckBuild | null = null;

	return {
		name: "remit-spellcheck",
		enforce: "pre",
		config(userConfig) {
			const base = `${(userConfig.base ?? "/").replace(/\/$/, "")}/spellcheck/`;
			staged = stageSpellcheck(process.env.REMIT_SPELLCHECK_LANGUAGES, base);
			return {
				define: {
					__REMIT_SPELLCHECK_LANGUAGES__: JSON.stringify(
						staged.languages.map((language) => language.tag),
					),
					__REMIT_SPELLCHECK_BASE__: JSON.stringify(base),
				},
			};
		},
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const held = staged;
				const url = (request.url ?? "").split("?")[0];
				if (!held || !url.startsWith(held.base)) return next();
				const wanted = decodeURIComponent(url.slice(held.base.length));
				const file = held.files.find((entry) => entry.path === wanted);
				if (!file) return next();
				response.setHeader("Content-Length", file.source.byteLength);
				response.setHeader(
					"Content-Type",
					wanted.endsWith(".mjs")
						? "text/javascript; charset=utf-8"
						: wanted.endsWith(".wasm")
							? "application/wasm"
							: wanted.endsWith(".json")
								? "application/json; charset=utf-8"
								: "text/plain; charset=utf-8",
				);
				response.end(file.source);
			});
		},
		generateBundle() {
			for (const file of staged?.files ?? []) {
				this.emitFile({
					type: "asset",
					fileName: `spellcheck/${file.path}`,
					source: file.source,
				});
			}
		},
	};
};
