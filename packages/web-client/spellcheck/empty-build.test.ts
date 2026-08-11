/**
 * The self-hoster's opt-out, proven by building it.
 *
 * `REMIT_SPELLCHECK_LANGUAGES=` is the documented way to build an image with no
 * spellchecker — a small box, or an operator who does not want to carry
 * somebody else's licence obligations. What it has to produce is a *clean*
 * build: a web client that works, with no `spellcheck/` tree to serve, and none
 * of the worker's code shipped to browsers that can never start it. Nothing
 * short of a real build can tell those apart from a broken one, so this runs
 * vite twice and reads the output.
 *
 * The second build is the control. Asserting only that an empty list emits no
 * worker chunk would pass just as well if the chunk were renamed, if the
 * composer stopped reaching the worker at all, or if the build quietly produced
 * nothing — so the same assertions are made against a build that must carry it.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { after, before, describe, it } from "node:test";

const packageRoot = resolve(import.meta.dirname, "..");

const BUILD_TIMEOUT_MS = 600_000;

const outputs: string[] = [];

// A child process, because the language set is read out of the environment when
// the plugin configures itself and two builds in one process would share it.
const build = (languages: string): readonly string[] => {
	const outDir = mkdtempSync(join(tmpdir(), "spellcheck-build-"));
	outputs.push(outDir);
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import { build } from "vite";
			 await build({
				 logLevel: "warn",
				 build: { outDir: ${JSON.stringify(outDir)}, emptyOutDir: true },
			 });`,
		],
		{
			cwd: packageRoot,
			encoding: "utf8",
			env: { ...process.env, REMIT_SPELLCHECK_LANGUAGES: languages },
		},
	);
	assert.equal(
		result.status,
		0,
		`vite build with REMIT_SPELLCHECK_LANGUAGES="${languages}" failed:\n${result.stdout}\n${result.stderr}`,
	);
	return emitted(outDir);
};

const emitted = (root: string): readonly string[] => {
	const found: string[] = [];
	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			found.push(relative(root, full).split(sep).join("/"));
		}
	};
	walk(root);
	return found.sort();
};

/**
 * The worker's own bundle. Vite emits it for whatever module graph reaches the
 * `new Worker(new URL(...))`, so its presence is the question: it is the code a
 * build with no dictionaries can never run.
 */
const workerChunks = (files: readonly string[]): readonly string[] =>
	files.filter((file) => /spellcheck-worker/.test(file));

const spellcheckAssets = (files: readonly string[]): readonly string[] =>
	files.filter((file) => file.startsWith("spellcheck/"));

describe("a build that carries no dictionaries", () => {
	let files: readonly string[] = [];

	before(() => {
		files = build("");
	}, { timeout: BUILD_TIMEOUT_MS });

	after(() => {
		for (const outDir of outputs) rmSync(outDir, { recursive: true, force: true });
	});

	it("is still a web client", () => {
		assert.ok(files.includes("index.html"), "the build emitted no index.html");
		assert.ok(
			files.some((file) => file.startsWith("assets/") && file.endsWith(".js")),
			"the build emitted no JavaScript",
		);
	});

	it("serves no spellcheck tree", () => {
		assert.deepEqual(spellcheckAssets(files), []);
	});

	it("ships no worker chunk to browsers that could never start it", () => {
		assert.deepEqual(workerChunks(files), []);
	});
});

describe("a build that carries one", () => {
	let files: readonly string[] = [];

	before(() => {
		files = build("nl");
	}, { timeout: BUILD_TIMEOUT_MS });

	it("stages the engine, the dictionary and the notice", () => {
		for (const path of [
			"spellcheck/hunspell.wasm",
			"spellcheck/hunspell.mjs",
			"spellcheck/manifest.json",
			"spellcheck/NOTICE.txt",
			"spellcheck/dictionaries/nl/index.aff",
			"spellcheck/dictionaries/nl/index.dic",
			"spellcheck/dictionaries/nl/LICENSE",
		]) {
			assert.ok(files.includes(path), `${path} was not emitted`);
		}
	});

	// The control for the two assertions above: both names are real, and a build
	// that should carry them does.
	it("ships the worker chunk the empty build must not", () => {
		assert.notDeepEqual(workerChunks(files), []);
	});
});
