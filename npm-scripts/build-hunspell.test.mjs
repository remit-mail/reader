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
import { readPins } from "./build-hunspell.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
const pins = readPins(join(root, "docker", "hunspell", "pin.env"));

describe("the spellchecker's build pins", () => {
	it("compiles the engine with the image the recipe names", () => {
		const stage = /^FROM (\S+) AS hunspell-wasm$/m.exec(dockerfile);
		assert.ok(stage, "the Dockerfile has no hunspell-wasm stage");
		assert.equal(stage[1], pins.EMSDK_IMAGE);
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
