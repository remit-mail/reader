// Walks the value-import graph of a workspace entry module without an install:
// relative imports and imports of a workspace package (through the `exports` its
// manifest declares) are followed; every other specifier is a leaf. Type-only
// imports erase at build, so they are neither followed nor reported.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
	importSpecifiers,
	loadWorkspace,
	packageNameOf,
} from "./publish-closure.mjs";

const resolveRelative = (from, spec) => {
	const base = resolve(dirname(from), spec);
	const stem = base.replace(/\.(m?js|jsx)$/, "");
	const found = [
		`${stem}.ts`,
		`${stem}.tsx`,
		base,
		join(base, "index.ts"),
	].find((path) => existsSync(path) && statSync(path).isFile());
	if (!found) throw new Error(`cannot resolve ${spec} from ${from}`);
	return found;
};

const resolveWorkspace = (repoRoot, workspace, spec) => {
	const name = packageNameOf(spec);
	const dir = workspace.workspaceNames.get(name);
	if (!dir) return undefined;
	const target =
		workspace.manifests.get(name).exports?.[`.${spec.slice(name.length)}`];
	const path = typeof target === "string" ? target : target?.default;
	if (!path) throw new Error(`${spec} is not an export of its package`);
	return join(repoRoot, dir, path);
};

// Every specifier the graph reaches, mapped to the repo-relative files that
// import it for a value, plus the files walked.
export const importGraph = (repoRoot, entry) => {
	const workspace = loadWorkspace(repoRoot);
	const specifiers = new Map();
	const files = new Set();
	const pending = [resolve(repoRoot, entry)];
	while (pending.length > 0) {
		const file = pending.pop();
		if (files.has(file)) continue;
		files.add(file);
		const importer = relative(repoRoot, file);
		for (const { spec, typeOnly } of importSpecifiers(
			readFileSync(file, "utf8"),
		)) {
			if (typeOnly) continue;
			if (spec.startsWith(".")) {
				pending.push(resolveRelative(file, spec));
				continue;
			}
			if (!specifiers.has(spec)) specifiers.set(spec, new Set());
			specifiers.get(spec).add(importer);
			const target = resolveWorkspace(repoRoot, workspace, spec);
			if (target) pending.push(target);
		}
	}
	return {
		specifiers,
		files: [...files].map((file) => relative(repoRoot, file)).sort(),
	};
};
