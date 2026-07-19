#!/usr/bin/env node
// Consumer-side acceptance for @remit/web-client. The package publishes
// `./vite-preset` and ships `harness/` for a distributor to build against, so
// the build toolchain those files import must be installable by a consumer —
// declared as dependencies or peerDependencies, not devDependencies (which a
// tarball consumer never gets). This guards the case the issue's acceptance
// hinges on: "a clean environment with only npm access can compose the
// primitives and bundle a servable app."
//
// Two checks, both off the packed tarball (works before the package is
// published, and before its @remit workspace deps exist on the registry):
//   1. Static — every third-party module the shipped harness imports is listed
//      in the tarball's dependencies/peerDependencies.
//   2. Resolve — in a clean dir with only the declared toolchain peers
//      installed, `@remit/web-client/vite-preset` and each toolchain import
//      resolve.
import { execFileSync } from "node:child_process";
import {
	cpSync,
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
	const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

	const declared = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	]);

	// 1. Static: every third-party module the shipped harness imports (directly
	// or via the shared vite.base at the package root) must be declared.
	const needed = new Set([
		...scanImports(join(pkgDir, "harness")),
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
	run("npm", ["install", ...toolchain, "--loglevel=error", "--no-audit", "--no-fund"], {
		cwd: consumer,
		stdio: "inherit",
	});
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

	console.log(
		"Consumer acceptance OK: @remit/web-client harness toolchain is declared and resolvable.",
	);
});
