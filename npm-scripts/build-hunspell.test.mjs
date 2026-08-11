// The engine's pins and the shipped language set each exist in two files that
// cannot import one another — a shell-sourced env file and a Dockerfile, a
// TypeScript module and a Dockerfile ARG. Nothing at build time notices when
// they disagree: the image would simply be compiled by a different toolchain,
// or carry different dictionaries than its NOTICE.txt claims.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	brotliSize,
	ceilingBreaches,
	ENGINE_CEILINGS,
	readPins,
} from "./build-hunspell.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
const pins = readPins(join(root, "docker", "hunspell", "pin.env"));

describe("the spellchecker's build pins", () => {
	it("compiles the engine with the image the recipe names", () => {
		const stage = /^FROM (\S+) AS hunspell-wasm-built$/m.exec(dockerfile);
		assert.ok(stage, "the Dockerfile has no hunspell-wasm-built stage");
		assert.equal(stage[1], pins.EMSDK_IMAGE);
	});

	it("selects that stage from the language set, so a default build compiles", () => {
		assert.match(
			dockerfile,
			/^FROM hunspell-wasm-\$\{SPELLCHECK_ENGINE\} AS hunspell-wasm$/m,
		);
		assert.match(
			dockerfile,
			/^ARG SPELLCHECK_ENGINE=\$\{REMIT_SPELLCHECK_LANGUAGES:\+built\}$/m,
		);
		assert.match(
			dockerfile,
			/^ARG SPELLCHECK_ENGINE=\$\{SPELLCHECK_ENGINE:-none\}$/m,
		);
	});

	it("pins an upstream release by checksum", () => {
		assert.match(pins.HUNSPELL_VERSION, /^\d+\.\d+\.\d+$/);
		assert.match(pins.HUNSPELL_SHA256, /^[0-9a-f]{64}$/);
	});

	it("ships the languages the table calls the default", () => {
		const arg = /^ARG REMIT_SPELLCHECK_LANGUAGES=(.*)$/m.exec(dockerfile);
		assert.ok(arg, "the Dockerfile fixes no language set");
		const table = readFileSync(
			join(root, "packages", "web-client", "spellcheck", "languages.ts"),
			"utf8",
		);
		const declared = /DEFAULT_SPELLCHECK_LANGUAGES = "([^"]*)"/.exec(table);
		assert.ok(declared, "languages.ts declares no default set");
		assert.equal(arg[1], declared[1]);
	});
});

// The engine is fetched once and shared by every language, so its size is the
// part of the spellchecker nobody opts out of. Nothing about `-Oz`, the source
// list or a toolchain bump announces itself in a diff, and 200 KB that became
// 400 KB would still work — which is why this is measured rather than reviewed.
// The measurement runs in npm-scripts/build-hunspell.mjs against the file it
// just produced; what is asserted here is the decision that measurement makes.
describe("the engine's size ceilings", () => {
	it("fixes a ceiling for both files the browser fetches", () => {
		assert.deepEqual(
			ENGINE_CEILINGS.map((ceiling) => ceiling.file),
			["hunspell.wasm", "hunspell.mjs"],
		);
		for (const { pin } of ENGINE_CEILINGS) {
			assert.match(pins[pin], /^\d+$/, `pin.env has no usable ${pin}`);
			assert.ok(Number(pins[pin]) > 0);
		}
	});

	it("passes an engine inside every ceiling", () => {
		const sizes = Object.fromEntries(
			ENGINE_CEILINGS.map(({ file, pin }) => [file, Number(pins[pin])]),
		);
		assert.deepEqual(ceilingBreaches(sizes, pins), []);
	});

	it("names the file, the excess and the pin when one grows", () => {
		const ceiling = Number(pins.HUNSPELL_MAX_WASM_BROTLI_BYTES);
		const [breach, ...rest] = ceilingBreaches(
			{ "hunspell.wasm": ceiling + 1024, "hunspell.mjs": 1 },
			pins,
		);
		assert.deepEqual(rest, []);
		assert.match(breach, /hunspell\.wasm/);
		assert.match(breach, new RegExp(`${ceiling + 1024} bytes brotli`));
		assert.match(breach, /1024 over/);
		assert.match(breach, /HUNSPELL_MAX_WASM_BROTLI_BYTES/);
	});

	// A ceiling nobody can read is not a generous ceiling. Left to `Number(...)`
	// alone it would be `NaN`, every comparison against it false, and the gate
	// would report a clean engine whatever the engine weighed.
	it("treats an unreadable ceiling as a failure, not as no limit", () => {
		const breaches = ceilingBreaches(
			{ "hunspell.wasm": 1, "hunspell.mjs": 1 },
			{ ...pins, HUNSPELL_MAX_WASM_BROTLI_BYTES: "plenty" },
		);
		assert.equal(breaches.length, 1);
		assert.match(breaches[0], /sets no usable HUNSPELL_MAX_WASM_BROTLI_BYTES/);
	});

	// The ceilings are brotli byte counts because brotli is the only form the
	// image stores, so the measurement has to be of the compressed file.
	it("measures the compressed size, not the file on disk", () => {
		const raw = Buffer.alloc(64 * 1024, "hunspell");
		assert.ok(brotliSize(raw) < raw.byteLength);
	});
});
