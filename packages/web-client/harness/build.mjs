#!/usr/bin/env node
// Reference distributor build over the web-client primitives. Composes the app
// shell with one auth provider and bundles a servable app with vite. This is
// the "build CLI as convenience over the primitives" — the primitives are the
// contract; this wraps them for the common case (reader's own self-host image
// build uses it).
//
// Usage: node harness/build.mjs [--auth <combined|cognito|better-auth>] [--out <dir>]
//   --auth  which identity system to compose in. Default: combined (both,
//           selected at runtime). `better-auth` and `cognito` omit the other
//           shell from the bundle entirely.
//   --out   output directory (relative to the package). Default: dist.
//
// The chosen provider can also be given via REMIT_AUTH_PROVIDER; the flag wins.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
// Loaded through tsx (see the `build:dist` script) so the .ts preset and the
// shared vite.base resolve without a prior compile step.
import { webClientPreset } from "./vite-preset.ts";

const harnessDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(harnessDir, "..");

const parseArgs = (argv) => {
	const args = {
		auth: process.env.REMIT_AUTH_PROVIDER ?? "combined",
		out: "dist",
	};
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === "--auth") {
			args.auth = argv[i + 1];
			i += 1;
		} else if (argv[i] === "--out") {
			args.out = argv[i + 1];
			i += 1;
		}
	}
	return args;
};

const PROVIDERS = {
	combined: {
		specifier: "@remit/web-client/auth/combined",
		name: "combinedAuthProvider",
		cognitoCss: true,
	},
	cognito: {
		specifier: "@remit/web-client/auth/cognito",
		name: "cognitoAuthProvider",
		cognitoCss: true,
	},
	"better-auth": {
		specifier: "@remit/web-client/auth/better-auth",
		name: "betterAuthProvider",
		cognitoCss: false,
	},
};

const entrySource = (provider) =>
	[
		provider.cognitoCss
			? 'import "@remit/web-client/styles/cognito.css";'
			: null,
		'import { mountApp } from "@remit/web-client/shell";',
		`import { ${provider.name} } from "${provider.specifier}";`,
		"",
		`mountApp({ authProvider: ${provider.name} });`,
		"",
	]
		.filter((line) => line !== null)
		.join("\n");

const run = async () => {
	const { auth, out } = parseArgs(process.argv.slice(2));
	const provider = PROVIDERS[auth];
	if (!provider) {
		console.error(
			`Unknown --auth "${auth}". Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`,
		);
		process.exit(1);
	}

	// A throwaway root holding just the entry and index.html. Everything else —
	// the shell, screens, styles, config.js — resolves out of the installed
	// package and its public dir, exactly as an external distributor's would.
	const root = join(packageDir, ".harness-build");
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	cpSync(join(harnessDir, "index.html"), join(root, "index.html"));
	writeFileSync(join(root, "entry.tsx"), entrySource(provider));

	const preset = webClientPreset();
	try {
		await build({
			...preset,
			root,
			publicDir: join(packageDir, "public"),
			build: {
				...preset.build,
				outDir: resolve(packageDir, out),
				emptyOutDir: true,
			},
		});
	} finally {
		// Never let cleanup replace the build's own failure. Removing the root is
		// best-effort housekeeping on a throwaway directory; a build error is the
		// thing the caller needs to see.
		await rm(root, { recursive: true, force: true }).catch((error) => {
			console.warn(`Could not remove ${root}: ${error.message}`);
		});
	}

	console.log(
		`Built web client (auth: ${auth}) to ${resolve(packageDir, out)}`,
	);
};

run();
