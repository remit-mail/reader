#!/usr/bin/env node
// Guards publish ordering: a package the pipeline ships to public npm must not
// import — anywhere in its runtime (non-test) source — a workspace package that
// stays private. A private dependency declared only as a devDependency would slip
// past a dependency-list check, so this walks the actual imports instead. Run
// before publishing so a package whose imports do not resolve off the public
// registry never ships.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const workspaceNames = new Map();
const manifests = new Map();
for (const name of readdirSync(join(repoRoot, "packages"))) {
	const dir = join("packages", name);
	let manifest;
	try {
		manifest = JSON.parse(
			readFileSync(join(repoRoot, dir, "package.json"), "utf8"),
		);
	} catch {
		continue;
	}
	workspaceNames.set(manifest.name, dir);
	manifests.set(manifest.name, manifest);
}

const closed = (name) => Boolean(manifests.get(name)?.private);
const publishable = [...manifests.values()].filter((m) => !m.private);

const sourceFiles = (dir) => {
	const out = [];
	const walk = (current) => {
		for (const entry of readdirSync(current)) {
			if (entry === "node_modules") continue;
			const path = join(current, entry);
			if (statSync(path).isDirectory()) {
				walk(path);
				continue;
			}
			if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry)) continue;
			if (/\.(test|spec)\.[a-z]+$/.test(entry)) continue;
			out.push(path);
		}
	};
	walk(dir);
	return out;
};

const importRe = /(?:from|import|require)\s*\(?\s*["'](@remit\/[^"']+)["']/g;
const packageOf = (specifier) => specifier.split("/").slice(0, 2).join("/");

const violations = [];
for (const manifest of publishable) {
	const srcDir = join(repoRoot, workspaceNames.get(manifest.name), "src");
	let files;
	try {
		files = sourceFiles(srcDir);
	} catch {
		continue;
	}
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		for (const match of text.matchAll(importRe)) {
			const imported = packageOf(match[1]);
			if (!workspaceNames.has(imported)) continue;
			if (!closed(imported)) continue;
			violations.push({
				pkg: manifest.name,
				imports: imported,
				file: file.slice(repoRoot.length + 1),
			});
		}
	}
}

if (violations.length === 0) {
	console.log(
		`Publish closure OK: ${publishable.length} publishable packages, no imports of closed packages.`,
	);
	process.exit(0);
}

console.error("Publish closure violations:\n");
const byPkg = new Map();
for (const v of violations) {
	if (!byPkg.has(v.pkg)) byPkg.set(v.pkg, new Map());
	const imports = byPkg.get(v.pkg);
	if (!imports.has(v.imports)) imports.set(v.imports, []);
	imports.get(v.imports).push(v.file);
}
for (const [pkg, imports] of byPkg) {
	console.error(`  ${pkg} (publishable) imports closed packages:`);
	for (const [imported, files] of imports) {
		console.error(`    ${imported} — ${files.length} file(s), e.g. ${files[0]}`);
	}
}
console.error(
	"\nEither cut the import, or mark the package private until the coupling is removed.",
);
process.exit(1);
