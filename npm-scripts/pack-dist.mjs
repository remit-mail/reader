#!/usr/bin/env node
// A workspace package that publishes compiled output instead of source. Inside
// the repo its `exports` point at `src`, so tsx, vite and tsgo read the source
// with no build step; the tarball must point at `dist`, because a consumer with
// stricter compiler flags than this repo cannot typecheck the source.
//
// npm has no `publishConfig.exports`, so the package's `packManifest` holds the
// published shape. `prepack` compiles `tsconfig.build.json` into dist and writes
// that shape over package.json; `postpack` puts the workspace manifest back. Both
// run around every `npm pack` and `npm publish`, so the publish tool and the
// consumer acceptance checks pack the same tarball.
//
// Usage (from the package directory): pack-dist.mjs prepack|postpack
import { execFileSync } from "node:child_process";
import {
	existsSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = process.cwd();
const manifestPath = join(pkgDir, "package.json");
const backupPath = join(pkgDir, ".package.json.workspace");
const mode = process.argv[2];

if (mode === "prepack") {
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (!manifest.packManifest) {
		throw new Error(`${manifest.name} declares no packManifest`);
	}
	rmSync(join(pkgDir, "dist"), { recursive: true, force: true });
	execFileSync(
		join(repoRoot, "node_modules/.bin/tsc"),
		["-p", "tsconfig.build.json"],
		{ cwd: pkgDir, stdio: "inherit" },
	);
	const { packManifest, ...rest } = manifest;
	writeFileSync(backupPath, readFileSync(manifestPath));
	writeFileSync(
		manifestPath,
		`${JSON.stringify({ ...rest, ...packManifest }, null, "\t")}\n`,
	);
} else if (mode === "postpack") {
	if (existsSync(backupPath)) renameSync(backupPath, manifestPath);
} else {
	throw new Error("usage: pack-dist.mjs prepack|postpack");
}
