#!/usr/bin/env node
// Consumer-side acceptance for @remit/web-client. The package publishes
// `./vite-preset` and ships `harness/` for a distributor to build against, so
// the build toolchain those files import must be installable by a consumer —
// declared as dependencies or peerDependencies, not devDependencies (which a
// tarball consumer never gets). This guards the case the issue's acceptance
// hinges on: "a clean environment with only npm access can compose the
// primitives and bundle a servable app."
//
// Three checks, all off the packed tarball (works before the package is
// published, and before its @remit workspace deps exist on the registry):
//   1. Static — every third-party module the shipped build code imports is
//      listed in the tarball's dependencies/peerDependencies.
//   2. Resolve — in a clean dir with only the declared toolchain peers
//      installed, `@remit/web-client/vite-preset` and each toolchain import
//      resolve.
//   3. Run — the spellcheck plugin is executed in that same clean dir. Resolving
//      a module proves nothing about what it does when called: the plugin read
//      `docker/hunspell/pin.env` through a path that is the repo root here and
//      `node_modules` there, so every consumer build died on an ENOENT naming a
//      file the tarball does not ship and no escape hatch out of it.
import { execFileSync, spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const run = (cmd, args, opts = {}) =>
	execFileSync(cmd, args, { encoding: "utf8", ...opts });

const packageNameOf = (specifier) => {
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

const isThirdParty = (specifier) =>
	// Skip template-literal specifiers — text the harness emits into a generated
	// entry, not an import it makes.
	!specifier.includes("${") &&
	!specifier.startsWith(".") &&
	!specifier.startsWith("#") &&
	!specifier.startsWith("@/") &&
	!specifier.startsWith("node:") &&
	!specifier.startsWith("@remit/");

const importSpecifiers = (source) => {
	const out = new Set();
	const re = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
	for (const match of source.matchAll(re)) out.add(match[1]);
	return [...out];
};

const scanImports = (dir) => {
	const found = new Set();
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) {
				walk(path);
				continue;
			}
			if (!/\.(ts|tsx|mts|cts|mjs|cjs|js)$/.test(entry.name)) continue;
			for (const spec of importSpecifiers(readFileSync(path, "utf8"))) {
				if (isThirdParty(spec)) found.add(packageNameOf(spec));
			}
		}
	};
	walk(dir);
	return found;
};

const withTempDir = (fn) => {
	const dir = mkdtempSync(join(tmpdir(), "remit-web-consumer-"));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

withTempDir((tmp) => {
	const packed = run("npm", [
		"pack",
		"-w",
		"@remit/web-client",
		"--pack-destination",
		tmp,
		"--loglevel=error",
	])
		.trim()
		.split("\n")
		.pop()
		.trim();
	run("tar", ["-xzf", join(tmp, packed), "-C", tmp]);
	const pkgDir = join(tmp, "package");
	const manifest = JSON.parse(
		readFileSync(join(pkgDir, "package.json"), "utf8"),
	);

	const declared = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	]);

	// 1. Static: every third-party module the shipped build code imports —
	// the harness, the spellcheck plugin vite.base pulls in, and vite.base
	// itself — must be declared.
	const needed = new Set([
		...scanImports(join(pkgDir, "harness")),
		...scanImports(join(pkgDir, "spellcheck")),
		...importSpecifiers(readFileSync(join(pkgDir, "vite.base.ts"), "utf8"))
			.filter(isThirdParty)
			.map(packageNameOf),
	]);

	const undeclared = [...needed].filter((spec) => !declared.has(spec));
	if (undeclared.length > 0) {
		console.error(
			`@remit/web-client ships harness code importing undeclared packages: ${undeclared.join(", ")}.\n` +
				"Declare them as dependencies or peerDependencies — a tarball consumer never gets devDependencies.",
		);
		process.exit(1);
	}

	// 2. Resolve: a consumer with only the declared toolchain peers installed can
	// resolve the vite-preset export and its toolchain imports.
	const toolchain = [
		"vite",
		"@vitejs/plugin-react",
		"@tailwindcss/vite",
		"tailwindcss",
		"@tanstack/router-plugin",
	];
	const consumer = join(tmp, "consumer");
	mkdirSync(consumer, { recursive: true });
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify({ name: "consumer", private: true }, null, 2),
	);
	// Install the declared toolchain peers first — a later npm run would prune an
	// extraneous package — then drop the packed web-client into node_modules
	// without npm resolving its (as-yet-unpublished) @remit workspace deps.
	run(
		"npm",
		["install", ...toolchain, "--loglevel=error", "--no-audit", "--no-fund"],
		{
			cwd: consumer,
			stdio: "inherit",
		},
	);
	mkdirSync(join(consumer, "node_modules", "@remit"), { recursive: true });
	cpSync(pkgDir, join(consumer, "node_modules", "@remit", "web-client"), {
		recursive: true,
	});
	run(
		"node",
		[
			"-e",
			[
				"require.resolve('@remit/web-client/vite-preset');",
				"['vite','@vitejs/plugin-react','@tailwindcss/vite','tailwindcss','@tanstack/router-plugin/vite']",
				".forEach((p) => require.resolve(p));",
			].join(""),
		],
		{ cwd: consumer, stdio: "inherit" },
	);

	// 3. Run: stage the spellchecker from inside that consumer, which has no
	// build/hunspell, no docker/hunspell/pin.env and no dictionary packages.
	// Every path through it has to end in either a staged tree or a sentence
	// naming the file and the way past it.
	const engine = join(tmp, "engine");
	mkdirSync(engine, { recursive: true });
	writeFileSync(join(engine, "hunspell.wasm"), "wasm-bytes");
	writeFileSync(join(engine, "hunspell.mjs"), "export default () => {};\n");
	writeFileSync(join(engine, "LICENSE"), "MPL\n");
	writeFileSync(join(engine, "license.hunspell"), "the triple\n");
	writeFileSync(
		join(engine, "pin.env"),
		"HUNSPELL_VERSION=1.7.3\nHUNSPELL_SHA256=deadbeef\nEMSDK_IMAGE=nowhere\n",
	);

	// Driven from the unpacked tarball rather than from the copy inside
	// node_modules, because node refuses to strip types under a node_modules
	// path. A consumer's vite compiles it either way; what is under test here is
	// what the plugin does, and this is the same files with the same
	// dictionaries beside them.
	writeFileSync(
		join(pkgDir, "spellcheck-probe.mjs"),
		[
			'import { stageSpellcheck } from "./spellcheck/vite-plugin.ts";',
			'const build = stageSpellcheck(process.env.REMIT_SPELLCHECK_LANGUAGES, "/");',
			"process.stdout.write(JSON.stringify(build.files.map((file) => file.path)));",
			"",
		].join("\n"),
	);

	const stage = (settings) => {
		const env = { ...process.env };
		delete env.REMIT_SPELLCHECK_ENGINE_DIR;
		delete env.REMIT_SPELLCHECK_LANGUAGES;
		return spawnSync(
			process.execPath,
			["--experimental-strip-types", "--no-warnings", "spellcheck-probe.mjs"],
			{ cwd: pkgDir, encoding: "utf8", env: { ...env, ...settings } },
		);
	};

	const refuse = (message) => {
		console.error(message);
		process.exit(1);
	};

	const names = (run, ...wanted) => {
		const said = `${run.stderr}${run.stdout}`;
		const silent = wanted.filter((word) => !said.includes(word));
		if (run.status === 0 || silent.length > 0) {
			refuse(
				`@remit/web-client staged the spellchecker in a consumer without saying ${silent.join(" or ") || "anything"}:\n${said}`,
			);
		}
	};

	names(
		stage({}),
		"hunspell.wasm",
		"REMIT_SPELLCHECK_ENGINE_DIR",
		"REMIT_SPELLCHECK_LANGUAGES=",
	);
	names(
		stage({ REMIT_SPELLCHECK_ENGINE_DIR: engine }),
		"dictionary-en",
		"REMIT_SPELLCHECK_LANGUAGES",
	);

	const emptied = stage({
		REMIT_SPELLCHECK_ENGINE_DIR: engine,
		REMIT_SPELLCHECK_LANGUAGES: "",
	});
	if (emptied.status !== 0 || emptied.stdout.trim() !== "[]") {
		refuse(
			`REMIT_SPELLCHECK_LANGUAGES= must build a web client with no spellchecker, and did not:\n${emptied.stderr}${emptied.stdout}`,
		);
	}

	// The supported path, end to end: an engine built elsewhere and the one
	// dictionary this consumer chose to install.
	const dictionary = join(repoRoot, "node_modules", "dictionary-en");
	if (!existsSync(dictionary)) {
		refuse(
			`${dictionary} is missing, so the consumer's staged build cannot be checked. Run npm ci first.`,
		);
	}
	cpSync(dictionary, join(pkgDir, "node_modules", "dictionary-en"), {
		recursive: true,
	});
	const staged = stage({
		REMIT_SPELLCHECK_ENGINE_DIR: engine,
		REMIT_SPELLCHECK_LANGUAGES: "en",
	});
	const wanted = [
		"hunspell.wasm",
		"hunspell.mjs",
		"dictionaries/en/index.aff",
		"dictionaries/en/index.dic",
		"dictionaries/en/LICENSE",
		"NOTICE.txt",
		"manifest.json",
	];
	const got = staged.status === 0 ? JSON.parse(staged.stdout) : [];
	const absent = wanted.filter((path) => !got.includes(path));
	if (absent.length > 0) {
		refuse(
			`REMIT_SPELLCHECK_ENGINE_DIR is the documented way to build this package outside the repo, and it did not stage ${absent.join(", ")}:\n${staged.stderr}${staged.stdout}`,
		);
	}

	console.log(
		"Consumer acceptance OK: @remit/web-client harness toolchain is declared and resolvable, and the spellchecker stages from a consumer's own engine directory.",
	);
});
