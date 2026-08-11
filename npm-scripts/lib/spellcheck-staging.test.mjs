// What the spellcheck plugin stages, exercised against a tree shaped like the
// published package rather than like this checkout: `spellcheck/` beside a
// `node_modules/`, no `build/hunspell/`, no `docker/hunspell/pin.env`. That is
// the layout a distributor builds in, and the one where the plugin used to fail
// on a pin file nobody outside this repo has, with an error naming neither the
// engine variable nor the way to build without a spellchecker.
//
// Nothing here installs anything: the engine and the dictionary are stand-ins
// of a few bytes, because what is under test is which file is read, what the
// browser is told to fetch, and what a person is told when a file is missing.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = join(root, "packages", "web-client", "spellcheck");

const ENGINE_SHA =
	"1111111111111111111111111111111111111111111111111111111111111111";

const PROBE = `import { stageSpellcheck } from "./spellcheck/vite-plugin.ts";

const given = process.env.PROBE_BASE;
const build = stageSpellcheck(
	process.env.REMIT_SPELLCHECK_LANGUAGES,
	given === "__unset__" ? undefined : given,
);
process.stdout.write(
	JSON.stringify({
		base: build.base,
		servePath: build.servePath,
		directory: build.directory,
		bytes: build.bytes,
		files: Object.fromEntries(
			build.files.map((file) => [file.path, file.source.toString("utf8")]),
		),
	}),
);
`;

const workspace = mkdtempSync(join(tmpdir(), "remit-spellcheck-staging-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

const pkg = join(workspace, "pkg");
const engine = join(workspace, "engine");

mkdirSync(pkg, { recursive: true });
writeFileSync(
	join(pkg, "package.json"),
	JSON.stringify({ name: "web-client", type: "module" }),
);
cpSync(source, join(pkg, "spellcheck"), { recursive: true });
writeFileSync(join(pkg, "probe.mjs"), PROBE);

mkdirSync(engine, { recursive: true });
writeFileSync(join(engine, "hunspell.wasm"), "wasm-bytes");
writeFileSync(join(engine, "hunspell.mjs"), "export default () => {};\n");
writeFileSync(join(engine, "LICENSE"), "MPL\n");
writeFileSync(join(engine, "license.hunspell"), "the triple\n");
writeFileSync(
	join(engine, "pin.env"),
	`HUNSPELL_VERSION=9.9.9\nHUNSPELL_SHA256=${ENGINE_SHA}\nEMSDK_IMAGE=nowhere\n`,
);

const dictionary = join(pkg, "node_modules", "dictionary-en");

const writeDictionary = (dic) => {
	mkdirSync(dictionary, { recursive: true });
	writeFileSync(
		join(dictionary, "package.json"),
		JSON.stringify({
			name: "dictionary-en",
			version: "4.0.0",
			main: "main.js",
		}),
	);
	writeFileSync(join(dictionary, "main.js"), "");
	writeFileSync(join(dictionary, "index.aff"), "SET UTF-8\n");
	writeFileSync(join(dictionary, "index.dic"), dic);
	writeFileSync(join(dictionary, "LICENSE"), "MIT\n");
};

const stage = ({ languages = "en", base = "/", withEngine = true } = {}) => {
	const env = {
		...process.env,
		PROBE_BASE: base ?? "__unset__",
		REMIT_SPELLCHECK_LANGUAGES: languages,
	};
	if (withEngine) env.REMIT_SPELLCHECK_ENGINE_DIR = engine;
	else delete env.REMIT_SPELLCHECK_ENGINE_DIR;
	const run = spawnSync(
		process.execPath,
		["--experimental-strip-types", "--no-warnings", "probe.mjs"],
		{ cwd: pkg, env, encoding: "utf8" },
	);
	return {
		ok: run.status === 0,
		said: `${run.stderr}${run.stdout}`,
		build: run.status === 0 ? JSON.parse(run.stdout) : null,
	};
};

describe("staging the spellchecker outside this repo", () => {
	it("serves the engine the distributor named, not a pin file it has no copy of", () => {
		writeDictionary("2\nreport\nready\n");
		const { ok, said, build } = stage();
		assert.ok(ok, said);
		assert.ok(build.files["hunspell.wasm"], "the engine is staged");
		assert.ok(
			build.files["NOTICE.txt"].includes(ENGINE_SHA),
			"the notice quotes the checksum of the engine beside it, not this repo's",
		);
		assert.ok(build.files["dictionaries/en/index.dic"]);
		assert.ok(build.files["dictionaries/en/LICENSE"]);
		assert.ok(JSON.parse(build.files["manifest.json"]).languages.length === 1);
	});

	it("says what is missing and both ways past it when there is no engine", () => {
		writeDictionary("2\nreport\nready\n");
		const { ok, said } = stage({ withEngine: false });
		assert.equal(ok, false, "a build with no engine cannot quietly succeed");
		assert.match(said, /hunspell\.wasm/);
		assert.match(said, /REMIT_SPELLCHECK_ENGINE_DIR/);
		assert.match(said, /REMIT_SPELLCHECK_LANGUAGES=/);
	});

	it("names the dictionary a consumer's install never carried", () => {
		rmSync(dictionary, { recursive: true, force: true });
		const { ok, said } = stage();
		assert.equal(ok, false);
		assert.match(said, /dictionary-en/);
		assert.match(said, /devDependency/);
		assert.match(said, /REMIT_SPELLCHECK_LANGUAGES/);
		writeDictionary("2\nreport\nready\n");
	});

	it("builds without a spellchecker when asked for no languages", () => {
		const { ok, said, build } = stage({ languages: "" });
		assert.ok(ok, said);
		assert.deepEqual(build.files, {});
		assert.equal(build.base, "");
	});
});

describe("where the browser is told to fetch it from", () => {
	it("hangs the staged directory off an absolute base", () => {
		writeDictionary("2\nreport\nready\n");
		const { build } = stage({ base: "/" });
		assert.match(build.base, /^\/spellcheck\/[0-9a-f]{16}\/$/);
		assert.equal(build.servePath, build.base);
	});

	it("treats an unset base as vite's own root", () => {
		const { build } = stage({ base: null });
		assert.match(build.base, /^\/spellcheck\/[0-9a-f]{16}\/$/);
	});

	it("carries a mounted app's base into the path", () => {
		const { build } = stage({ base: "/reader/" });
		assert.match(build.base, /^\/reader\/spellcheck\/[0-9a-f]{16}\/$/);
	});

	// Storybook builds with base "./" and is published under a path it cannot
	// know here — /reader/pr/<n>/<sha>/ on Pages. An absolute path baked in at
	// build time 404s there, so the build hands over the directory alone and the
	// document resolves it. The dev server still answers at the document root.
	it("leaves a relative base for the document to resolve", () => {
		const { build } = stage({ base: "./" });
		assert.match(build.base, /^spellcheck\/[0-9a-f]{16}\/$/);
		assert.equal(build.servePath, `/${build.base}`);
	});
});

describe("what makes the staged tree cacheable", () => {
	it("names the directory after the bytes inside it", () => {
		writeDictionary("2\nreport\nready\n");
		const first = stage().build;
		writeDictionary("3\nreport\nready\nrewritten\n");
		const second = stage().build;
		assert.notEqual(
			first.directory,
			second.directory,
			"a changed dictionary must not be masked by a year-long immutable cache",
		);
		assert.match(second.directory, /^spellcheck\/[0-9a-f]{16}\/$/);
	});

	it("weighs what opening a language downloads", () => {
		writeDictionary("2\nreport\nready\n");
		const { build } = stage();
		assert.equal(
			build.bytes.en,
			"wasm-bytes".length + "SET UTF-8\n".length + "2\nreport\nready\n".length,
			"the engine and the two dictionary files, uncompressed",
		);
	});
});
