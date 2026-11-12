// Walks the module graph a consumer's compiler loads from a built declaration
// entry. Unlike the value graph, type-only imports count: tsc resolves every
// import of every file it reads. Relative imports are followed through the
// emitted `.d.ts` files. A workspace package that publishes its source is
// followed through the `types` of its `exports`, since a consumer typechecks
// that source in full; a package that publishes compiled output is a leaf, held
// to its own declarations by the consumer typecheck acceptance.
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
		`${stem}.d.ts`,
		`${stem}.ts`,
		`${stem}.tsx`,
		base,
		join(base, "index.d.ts"),
		join(base, "index.ts"),
	].find((path) => existsSync(path) && statSync(path).isFile());
	if (!found) throw new Error(`cannot resolve ${spec} from ${from}`);
	return found;
};

const resolveSourcePackage = (repoRoot, workspace, spec) => {
	const name = packageNameOf(spec);
	const dir = workspace.workspaceNames.get(name);
	if (!dir) return undefined;
	const manifest = workspace.manifests.get(name);
	if (manifest.packManifest) return undefined;
	const target = manifest.exports?.[`.${spec.slice(name.length)}`];
	const path = typeof target === "string" ? target : target?.types;
	if (!path) throw new Error(`${spec} is not an export of its package`);
	return join(repoRoot, dir, path);
};

// Every bare specifier the graph reaches, mapped to the files that import it
// (relative to `labelRoot`), plus the files walked.
export const declarationGraph = (repoRoot, entry, labelRoot = repoRoot) => {
	const workspace = loadWorkspace(repoRoot);
	const specifiers = new Map();
	const files = new Set();
	const pending = [resolve(entry)];
	while (pending.length > 0) {
		const file = pending.pop();
		if (files.has(file)) continue;
		files.add(file);
		const importer = relative(labelRoot, file);
		for (const { spec } of importSpecifiers(readFileSync(file, "utf8"))) {
			if (spec.startsWith(".")) {
				pending.push(resolveRelative(file, spec));
				continue;
			}
			if (!specifiers.has(spec)) specifiers.set(spec, new Set());
			specifiers.get(spec).add(importer);
			const target = resolveSourcePackage(repoRoot, workspace, spec);
			if (target) pending.push(target);
		}
	}
	return {
		specifiers,
		files: [...files].map((file) => relative(labelRoot, file)).sort(),
	};
};
