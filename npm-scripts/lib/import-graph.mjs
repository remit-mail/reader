// Walks the value-import graph of a workspace entry module without an install:
// relative imports and imports of a workspace package (through the `exports` its
// manifest declares) are followed; every other specifier is a leaf. Type-only
// imports erase at build, so they are neither followed nor reported.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const stripComments = (source) =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");

const isTypeOnlyClause = (clause) => {
	const trimmed = clause.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
	const members = trimmed
		.slice(1, -1)
		.split(",")
		.map((member) => member.trim())
		.filter(Boolean);
	return members.length > 0 && members.every((m) => m.startsWith("type "));
};

export const valueImports = (raw) => {
	const source = stripComments(raw);
	const specs = [];
	const statement =
		/\b(import|export)\s+(type\s+)?([^"';]*?)\s*\bfrom\s*["']([^"']+)["']/g;
	for (const [, , typeKeyword, clause, spec] of source.matchAll(statement)) {
		if (typeKeyword || isTypeOnlyClause(clause)) continue;
		specs.push(spec);
	}
	for (const [, spec] of source.matchAll(/\bimport\s*["']([^"']+)["']/g))
		specs.push(spec);
	for (const [, spec] of source.matchAll(
		/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
	))
		specs.push(spec);
	return specs;
};

export const workspaceExports = (repoRoot) => {
	const packages = new Map();
	for (const name of readdirSync(join(repoRoot, "packages"))) {
		const dir = join(repoRoot, "packages", name);
		const manifestPath = join(dir, "package.json");
		if (!existsSync(manifestPath)) continue;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		packages.set(manifest.name, { dir, exports: manifest.exports ?? {} });
	}
	return packages;
};

const packageNameOf = (spec) => {
	const parts = spec.split("/");
	return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

const exportTarget = (target) =>
	typeof target === "string" ? target : (target?.default ?? target?.import);

const resolveRelative = (from, spec) => {
	const base = resolve(dirname(from), spec);
	const stem = base.replace(/\.(m?js|jsx)$/, "");
	const candidates = [
		`${stem}.ts`,
		`${stem}.tsx`,
		base,
		join(base, "index.ts"),
		join(base, "index.tsx"),
	];
	const found = candidates.find(
		(path) => existsSync(path) && statSync(path).isFile(),
	);
	if (!found) throw new Error(`cannot resolve ${spec} from ${from}`);
	return found;
};

const resolveWorkspace = (packages, spec) => {
	const pkg = packages.get(packageNameOf(spec));
	if (!pkg) return undefined;
	const subpath = `.${spec.slice(packageNameOf(spec).length)}`;
	const target = exportTarget(pkg.exports[subpath]);
	if (!target) throw new Error(`${spec} is not an export of its package`);
	return join(pkg.dir, target);
};

// Every specifier the graph reaches, mapped to the repo-relative files that
// import it for a value, plus the files walked.
export const importGraph = (repoRoot, entry) => {
	const packages = workspaceExports(repoRoot);
	const specifiers = new Map();
	const files = new Set();
	const pending = [resolve(repoRoot, entry)];
	while (pending.length > 0) {
		const file = pending.pop();
		if (files.has(file)) continue;
		files.add(file);
		const importer = relative(repoRoot, file);
		for (const spec of valueImports(readFileSync(file, "utf8"))) {
			if (spec.startsWith(".")) {
				pending.push(resolveRelative(file, spec));
				continue;
			}
			if (!specifiers.has(spec)) specifiers.set(spec, new Set());
			specifiers.get(spec).add(importer);
			const target = resolveWorkspace(packages, spec);
			if (target) pending.push(target);
		}
	}
	return {
		specifiers,
		files: [...files].map((file) => relative(repoRoot, file)).sort(),
	};
};
