#!/usr/bin/env node
import { execFileSync } from "node:child_process";
// Builds the spellchecker's engine into build/hunspell/ by running the same
// docker/hunspell/build.sh the image's hunspell-wasm stage runs, inside
// the same pinned Emscripten image. Nothing else in the repo needs a compiler.
//
// A stamp records what produced the output — the pins plus the checksums of the
// build script and its glue — so a second run is free and a moved pin rebuilds.
// `build-hunspell.mjs key` prints that stamp folded into one token, which is
// what .github/actions/hunspell keys its cache on: same inputs, same decision.
//
// The size ceilings are checked here rather than in build.sh because this is the
// path CI takes: every input that can change the engine is in that key, so a
// recipe or a pin that moves lands on a run that rebuilds and measures.
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recipeDir = join(repoRoot, "docker", "hunspell");
const outDir = join(repoRoot, "build", "hunspell");
const stagingDir = join(repoRoot, "build", "hunspell.next");
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

// Which output answers to which pin. Both are fetched once per browser and
// shared by every language, so they are the part of the download nobody can
// opt out of by writing in fewer languages.
export const ENGINE_CEILINGS = [
	{ file: "hunspell.wasm", pin: "HUNSPELL_MAX_WASM_BROTLI_BYTES" },
	{ file: "hunspell.mjs", pin: "HUNSPELL_MAX_LOADER_BROTLI_BYTES" },
];

/**
 * What the file costs on the wire. The image stores and serves brotli and
 * nothing else (npm-scripts/compress-spellcheck.mjs), so the compressed byte
 * count is the shipped size rather than an estimate of it.
 */
export const brotliSize = (bytes) =>
	brotliCompressSync(bytes, {
		params: {
			[constants.BROTLI_PARAM_QUALITY]: 11,
			[constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
		},
	}).byteLength;

/**
 * Every ceiling this build broke, said in the terms a reader needs to decide
 * whether to shrink the engine or move the pin: which file, what it costs now,
 * what it was allowed, and how far over it went.
 *
 * A ceiling with no pin is a failure too. An unreadable pin would otherwise
 * read as "no limit", which is the one answer a size gate must never give.
 */
export const ceilingBreaches = (sizes, pins) =>
	ENGINE_CEILINGS.flatMap(({ file, pin }) => {
		const ceiling = Number(pins[pin]);
		if (!Number.isInteger(ceiling) || ceiling <= 0) {
			return [
				`docker/hunspell/pin.env sets no usable ${pin}: ${JSON.stringify(pins[pin])}`,
			];
		}
		const size = sizes[file];
		if (size <= ceiling) return [];
		const over = size - ceiling;
		const percent = ((over / ceiling) * 100).toFixed(1);
		return [
			`${file} is ${size} bytes brotli, ${over} over the ${ceiling}-byte ${pin} in docker/hunspell/pin.env (${percent}% over)`,
		];
	});

const assertWithinCeilings = (pins, dir) => {
	const sizes = Object.fromEntries(
		ENGINE_CEILINGS.map(({ file }) => [
			file,
			brotliSize(readFileSync(join(dir, file))),
		]),
	);
	const breaches = ceilingBreaches(sizes, pins);
	if (breaches.length > 0) {
		throw new Error(
			`the spellchecker's engine grew past what this repo ships:\n  ${breaches.join(
				"\n  ",
			)}\nShrink it, or move the pin in the same commit that explains why every writer should pay for it.`,
		);
	}
	for (const { file } of ENGINE_CEILINGS) {
		console.log(`${file}: ${sizes[file]} bytes brotli`);
	}
};

export const engineStamp = () => {
	const pins = readPins(join(recipeDir, "pin.env"));
	return {
		version: pins.HUNSPELL_VERSION,
		tarball: pins.HUNSPELL_SHA256,
		image: pins.EMSDK_IMAGE,
		recipe: digestOf([
			join(recipeDir, "build.sh"),
			join(recipeDir, "glue.cxx"),
			join(recipeDir, "pin.env"),
		]),
	};
};

/**
 * The stamp folded into one token, so CI can key a cache on the same inputs the
 * stamp check uses. A cache entry under this key holds an engine this recipe
 * would have produced, which is what makes restoring it equivalent to building.
 */
export const engineKey = () =>
	createHash("sha256")
		.update(JSON.stringify(engineStamp()))
		.digest("hex")
		.slice(0, 32);

/**
 * Rootless podman maps the caller to root inside the container, so a bare
 * `--user uid:gid` names a subordinate id that cannot write the bind mount.
 * `--userns=keep-id` maps the caller to the same id inside, which can — but
 * only the podman CLI accepts it; the docker CLI rejects every userns mode but
 * `host`. Without the podman CLI, container root is the caller, so root it is.
 */
export const isPodman = (dockerHost, serverComponents) =>
	/podman/i.test(dockerHost ?? "") || /podman/i.test(serverComponents);

export const containerRunner = ({ podman, podmanCli, uid, gid }) => {
	if (!podman) return { cli: "docker", args: ["--user", `${uid}:${gid}`] };
	if (podmanCli) {
		return {
			cli: "podman",
			args: ["--userns=keep-id", "--user", `${uid}:${gid}`],
		};
	}
	return { cli: "docker", args: ["--user", "0:0"] };
};

const hasPodmanCli = () => {
	try {
		execFileSync("podman", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

const dockerServerComponents = () => {
	try {
		return execFileSync(
			"docker",
			["version", "--format", "{{range .Server.Components}}{{.Name}} {{end}}"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		);
	} catch {
		return "";
	}
};

const run = (force) => {
	const pins = readPins(join(recipeDir, "pin.env"));
	const wanted = engineStamp();

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
		assertWithinCeilings(pins, outDir);
		return;
	}
	if (!force && existsSync(join(outDir, "hunspell.wasm"))) {
		console.log(
			`hunspell: ${outDir} holds an engine this recipe did not stamp; keeping it. Rebuild with: npm run build:hunspell -- --force`,
		);
		return;
	}

	// Built beside the engine and swapped in only once it passes, so a failed
	// or oversized build never costs the working engine it would replace.
	rmSync(stagingDir, { recursive: true, force: true });
	mkdirSync(stagingDir, { recursive: true });
	const podman = isPodman(process.env.DOCKER_HOST, dockerServerComponents());
	const runner = containerRunner({
		podman,
		podmanCli: podman && hasPodmanCli(),
		uid: process.getuid(),
		gid: process.getgid(),
	});
	try {
		execFileSync(
			runner.cli,
			[
				"run",
				"--rm",
				...runner.args,
				"-v",
				`${repoRoot}:/src`,
				"-e",
				"OUT_DIR=/src/build/hunspell.next",
				"-w",
				"/src",
				wanted.image,
				"sh",
				"docker/hunspell/build.sh",
			],
			{ stdio: "inherit" },
		);
		// Before the stamp, so an engine that broke a ceiling is never recorded as a
		// build somebody can reuse: the next run compiles it again and fails again.
		assertWithinCeilings(pins, stagingDir);
		writeFileSync(
			join(stagingDir, "stamp.json"),
			`${JSON.stringify(wanted, null, "\t")}\n`,
		);
		rmSync(outDir, { recursive: true, force: true });
		renameSync(stagingDir, outDir);
	} finally {
		rmSync(stagingDir, { recursive: true, force: true });
	}
	console.log(`hunspell ${wanted.version}: built into ${outDir}`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.argv[2] === "key") console.log(engineKey());
	else
		run(process.argv.includes("--force") || process.env.HUNSPELL_FORCE === "1");
}
