#!/usr/bin/env node
import { execFileSync } from "node:child_process";
// Builds the spellchecker's engine into build/hunspell/ by running the same
// docker/build/hunspell/build.sh the image's hunspell-wasm stage runs, inside
// the same pinned Emscripten image. Nothing else in the repo needs a compiler.
//
// A stamp records what produced the output — the pins plus the checksums of the
// build script and its glue — so a second run is free and a moved pin rebuilds.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recipeDir = join(repoRoot, "docker", "build", "hunspell");
const outDir = join(repoRoot, "build", "hunspell");
const stampFile = join(outDir, "stamp.json");

export const readPins = (envFile) => {
	const pins = {};
	for (const line of readFileSync(envFile, "utf8").split("\n")) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (match) pins[match[1]] = match[2];
	}
	return pins;
};

const digestOf = (paths) => {
	const hash = createHash("sha256");
	for (const path of paths) hash.update(readFileSync(path));
	return hash.digest("hex");
};

const run = () => {
	const pins = readPins(join(recipeDir, "pin.env"));
	const wanted = {
		version: pins.HUNSPELL_VERSION,
		tarball: pins.HUNSPELL_SHA256,
		image: pins.EMSDK_IMAGE,
		recipe: digestOf([
			join(recipeDir, "build.sh"),
			join(recipeDir, "glue.cxx"),
			join(recipeDir, "pin.env"),
		]),
	};

	const built = (() => {
		try {
			return JSON.parse(readFileSync(stampFile, "utf8"));
		} catch {
			return null;
		}
	})();
	if (
		built &&
		Object.entries(wanted).every(([key, value]) => built[key] === value)
	) {
		console.log(`hunspell ${wanted.version}: already built in ${outDir}`);
		return;
	}

	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	execFileSync(
		"docker",
		[
			"run",
			"--rm",
			"--user",
			`${process.getuid()}:${process.getgid()}`,
			"-v",
			`${repoRoot}:/src`,
			"-e",
			"OUT_DIR=/src/build/hunspell",
			"-w",
			"/src",
			wanted.image,
			"sh",
			"docker/build/hunspell/build.sh",
		],
		{ stdio: "inherit" },
	);
	writeFileSync(stampFile, `${JSON.stringify(wanted, null, "\t")}\n`);
	console.log(`hunspell ${wanted.version}: built into ${outDir}`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
