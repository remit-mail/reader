/**
 * Turns `REMIT_SPELLCHECK_LANGUAGES` into what the browser fetches: the engine,
 * one directory per language holding the upstream `.aff`, `.dic` and licence
 * text byte for byte, a manifest, and the notice generated from it.
 *
 * Nothing here is bundled and nothing is fetched at page load. The build's own
 * job is that the notice describes the image exactly — which is the reason the
 * language set is fixed at build time at all — so a tag nobody can ship, or a
 * dictionary whose licence file is missing, fails the build by name.
 *
 * Two audiences build this package: this repo, where `npm run build:hunspell`
 * leaves an engine in `build/hunspell/`, and a distributor building from the
 * published tarball, which carries neither an engine nor a dictionary. Every
 * failure below therefore names the file it wanted and both ways past it —
 * `REMIT_SPELLCHECK_ENGINE_DIR` for an engine built elsewhere, and an empty
 * `REMIT_SPELLCHECK_LANGUAGES` for a build with no spellchecker at all.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { DictionarySource } from "./languages.ts";
import { resolveLanguages } from "./languages.ts";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
// The repo root when this file is a checkout, and `node_modules` when it is an
// installed package — which holds neither the engine nor the pins. Nothing is
// read from here without a fallback and an error that names the alternative.
const repoRoot = join(here, "..", "..", "..");
// Where `npm run build:hunspell` leaves the engine. A distributor building the
// web client from the published package has no such tree, so the location is
// theirs to name.
const engineDir =
	process.env.REMIT_SPELLCHECK_ENGINE_DIR ??
	join(repoRoot, "build", "hunspell");

const WAYS_OUT = [
	"Set REMIT_SPELLCHECK_ENGINE_DIR to a directory holding hunspell.wasm, hunspell.mjs, LICENSE, license.hunspell and pin.env — in this repo `npm run build:hunspell` writes one into build/hunspell/.",
	"Or set REMIT_SPELLCHECK_LANGUAGES= (empty) to build a web client with no spellchecker at all; the browser's own checker stays on either way.",
].join("\n");

const LICENCE_NAMES = ["LICENSE", "license", "LICENCE", "licence"];

/** The engine's own files, in the order the browser needs them explained. */
const ENGINE_FILES = [
	"hunspell.wasm",
	"hunspell.mjs",
	"LICENSE",
	"license.hunspell",
];

interface StagedFile {
	readonly path: string;
	readonly source: Buffer;
}

interface StagedLanguage extends DictionarySource {
	readonly version: string;
	readonly bytes: number;
	readonly files: readonly StagedFile[];
}

/**
 * The pins describe the engine, so they are read from beside it: an engine dir
 * a distributor points at carries the `pin.env` its own build used, and the
 * checksum in NOTICE.txt is then the checksum of the bytes being served rather
 * than of whatever this checkout happens to pin.
 */
const pinFile = (): string => {
	const beside = join(engineDir, "pin.env");
	if (existsSync(beside)) return beside;
	const inRepo = join(repoRoot, "docker", "hunspell", "pin.env");
	if (existsSync(inRepo)) return inRepo;
	throw new Error(
		`The engine at ${engineDir} carries no pin.env, and neither does ${inRepo}, so nothing here can say which Hunspell release is being served and NOTICE.txt would have to guess.\n${WAYS_OUT}`,
	);
};

let pins: Record<string, string> | null = null;

const readPin = (name: string): string => {
	const path = pinFile();
	pins ??= Object.fromEntries(
		readFileSync(path, "utf8")
			.split("\n")
			.flatMap((line) => {
				const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
				return match ? [[match[1], match[2]] as const] : [];
			}),
	);
	const found = pins[name];
	if (found === undefined) throw new Error(`${path} has no ${name}`);
	return found;
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

const stageEngine = (): StagedFile[] =>
	ENGINE_FILES.map((name) => {
		const path = join(engineDir, name);
		if (!existsSync(path)) {
			throw new Error(
				`${path} is missing, so this build has no spellchecking engine to serve.\n${WAYS_OUT}`,
			);
		}
		return { path: name, source: readFileSync(path) };
	});

/**
 * A `dictionary-*` package is a devDependency of @remit/web-client, which a
 * consumer of the published tarball never receives — so a missing one is the
 * ordinary case out here, not a broken install.
 */
const dictionaryDir = (source: DictionarySource): string => {
	try {
		// Resolved through the package's own entry point: `dictionary-*` declares an
		// `exports` map, so its package.json is not a resolvable subpath.
		return dirname(require.resolve(source.package));
	} catch {
		throw new Error(
			`${source.package} is not installed, so the ${source.tag} dictionary cannot be staged. It is a devDependency of @remit/web-client and a consumer of the published package never gets it.\nInstall ${source.package} alongside @remit/web-client, or drop "${source.tag}" from REMIT_SPELLCHECK_LANGUAGES — set it empty to build with no spellchecker at all.`,
		);
	}
};

const stageLanguage = (source: DictionarySource): StagedLanguage => {
	const directory = dictionaryDir(source);
	const version = JSON.parse(
		readFileSync(join(directory, "package.json"), "utf8"),
	).version;
	const licence = licenceIn(directory);
	const at = (name: string) => `dictionaries/${source.tag}/${name}`;
	const aff = readFileSync(join(directory, "index.aff"));
	const dic = readFileSync(join(directory, "index.dic"));
	return {
		...source,
		version,
		bytes: aff.byteLength + dic.byteLength,
		files: [
			{ path: at("index.aff"), source: aff },
			{ path: at("index.dic"), source: dic },
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
			`  Licence text: dictionaries/${language.tag}/LICENSE, beside this file`,
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
		"  Licence text: LICENSE, beside this file",
		"  Build recipe: docker/hunspell/build.sh",
		"",
		"Dictionaries",
		"",
		...blocks.map((block) => `${block}\n`),
	].join("\n");
};

export interface SpellcheckBuild {
	readonly languages: readonly StagedLanguage[];
	/** Paths relative to `directory`, which is where all of them are emitted. */
	readonly files: readonly StagedFile[];
	/** `spellcheck/<digest>/`, relative to the build's output root. */
	readonly directory: string;
	/** What the browser resolves against the document to reach `directory`. */
	readonly base: string;
	/** Where the dev server answers for `directory`, always document-rooted. */
	readonly servePath: string;
	/** Tag → the bytes opening that language downloads, engine included. */
	readonly bytes: Readonly<Record<string, number>>;
}

const EMPTY_BUILD: SpellcheckBuild = {
	languages: [],
	files: [],
	directory: "",
	base: "",
	servePath: "",
	bytes: {},
};

/**
 * One digest over everything served, folded into the directory name. Nothing
 * the browser fetches is versioned otherwise — `hunspell.wasm` and `index.dic`
 * are the same two paths in every build — and an unversioned path cannot be
 * cached, which is what left every composer open re-downloading its dictionary.
 */
const digestOf = (files: readonly StagedFile[]): string => {
	const hash = createHash("sha256");
	for (const file of [...files].sort((left, right) =>
		left.path.localeCompare(right.path),
	)) {
		hash.update(file.path);
		hash.update("\0");
		hash.update(file.source);
	}
	return hash.digest("hex").slice(0, 16);
};

const documentRooted = (viteBase: string | undefined): boolean =>
	viteBase === undefined || viteBase.startsWith("/");

/**
 * An absolute base names where the app is mounted, and the staged directory
 * hangs off it. A relative one — Storybook's, always `./` — belongs to a build
 * published under a path it cannot know here (`/reader/pr/<n>/<sha>/`), so it
 * gets the directory alone and the document resolves it at run time. An unset
 * base is vite's own default of `/`, not a relative one.
 */
const browserBase = (
	viteBase: string | undefined,
	directory: string,
): string =>
	documentRooted(viteBase)
		? `${(viteBase ?? "/").replace(/\/$/, "")}/${directory}`
		: directory;

export const stageSpellcheck = (
	requested: string | undefined,
	viteBase: string | undefined,
): SpellcheckBuild => {
	const wanted = resolveLanguages(requested);
	if (wanted.length === 0) return EMPTY_BUILD;

	// The engine first: it is the file a build outside this repo is most likely
	// to be missing, and its error is the one that names both ways out.
	const engine = stageEngine();
	const engineVersion = readPin("HUNSPELL_VERSION");
	const languages = wanted.map(stageLanguage);
	const wasmBytes =
		engine.find((file) => file.path === "hunspell.wasm")?.source.byteLength ??
		0;

	const payload = [
		...engine,
		...languages.flatMap((language) => language.files),
	];
	const directory = `spellcheck/${digestOf(payload)}/`;

	const manifest = {
		engine: {
			project: "Hunspell",
			version: engineVersion,
			licence: "MPL-1.1",
			source: "https://github.com/hunspell/hunspell",
			recipe: "docker/hunspell/build.sh",
			bytes: wasmBytes,
		},
		languages: languages.map((language) => ({
			tag: language.tag,
			project: language.project,
			authors: language.authors,
			source: language.source,
			package: `${language.package}@${language.version}`,
			licence: language.licence,
			licenceFile: `dictionaries/${language.tag}/LICENSE`,
			bytes: language.bytes,
		})),
	};

	return {
		languages,
		directory,
		base: browserBase(viteBase, directory),
		servePath: `${(documentRooted(viteBase) ? (viteBase ?? "/") : "/").replace(/\/$/, "")}/${directory}`,
		bytes: Object.fromEntries(
			languages.map((language) => [language.tag, wasmBytes + language.bytes]),
		),
		files: [
			...payload,
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
			staged = stageSpellcheck(
				process.env.REMIT_SPELLCHECK_LANGUAGES,
				userConfig.base,
			);
			return {
				define: {
					__REMIT_SPELLCHECK_LANGUAGES__: JSON.stringify(
						staged.languages.map((language) => language.tag),
					),
					__REMIT_SPELLCHECK_BASE__: JSON.stringify(staged.base),
					__REMIT_SPELLCHECK_BYTES__: JSON.stringify(staged.bytes),
				},
			};
		},
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const held = staged;
				const url = (request.url ?? "").split("?")[0];
				if (!held || held.servePath === "" || !url.startsWith(held.servePath))
					return next();
				const wanted = decodeURIComponent(url.slice(held.servePath.length));
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
			const held = staged;
			if (!held) return;
			for (const file of held.files) {
				this.emitFile({
					type: "asset",
					fileName: `${held.directory}${file.path}`,
					source: file.source,
				});
			}
		},
	};
};
