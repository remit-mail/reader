// The local @remit closure of a package, packed as tarballs.
//
// Neither the workspace packages under packages/ nor the TypeSpec-generated
// packages under build/ are independently published artifacts, so a consumer
// acceptance check that resolves them off the registry asserts registry state
// rather than this tree. Both are packed from where this tree produced them;
// only third-party and @types dependencies come off the registry.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_PACKAGES } from "./generated-packages.mjs";
import { loadWorkspace } from "./publish-closure.mjs";

const generatedByName = new Map(
	GENERATED_PACKAGES.map((pkg) => [pkg.name, pkg]),
);

// The @remit packages `root` needs, transitively, split by where they live. A
// @remit/* dependency that is neither a workspace member nor a generated
// package cannot be resolved locally, and fails loudly rather than silently
// falling back to the registry.
export const remitClosure = (repoRoot, root) => {
	const { workspaceNames, manifests } = loadWorkspace(repoRoot);
	const seen = new Set();
	const workspace = new Set();
	const generated = new Set();
	const visit = (name) => {
		if (seen.has(name)) return;
		seen.add(name);
		if (workspaceNames.has(name)) {
			workspace.add(name);
			const manifest = manifests.get(name);
			for (const dep of Object.keys(manifest.dependencies ?? {}))
				if (dep.startsWith("@remit/")) visit(dep);
			return;
		}
		if (generatedByName.has(name)) {
			generated.add(name);
			return;
		}
		throw new Error(
			`${root} depends on ${name}, which is neither a packages/* workspace ` +
				"member nor a generated package listed in " +
				"npm-scripts/lib/generated-packages.mjs — this check cannot resolve " +
				"it locally and refuses to silently fall back to the registry.",
		);
	};
	visit(root);
	return {
		workspace: [...workspace].map((name) => ({
			name,
			dir: workspaceNames.get(name),
		})),
		generated: [...generated].map((name) => generatedByName.get(name)),
	};
};

// Generated packages only exist once this tree's codegen has run. Fail loudly
// here — a missing build/ directory must not silently resolve the package off
// the registry instead, which is exactly the bug these checks used to have.
export const assertCodegenRan = (repoRoot, generated) => {
	const missing = generated.filter(
		(pkg) => !existsSync(join(repoRoot, pkg.dir, "package.json")),
	);
	if (missing.length === 0) return;
	console.error(
		"Missing generated package(s) — run `npm run codegen` (or `make`) first:\n" +
			missing.map((pkg) => `  ${pkg.name} (expected at ${pkg.dir})`).join("\n"),
	);
	process.exit(1);
};

// Pack each package from this tree into packDir, keyed by package name so a
// caller can point a dependency or an override at its tarball.
export const packClosure = (repoRoot, packages, packDir) => {
	const tarballs = new Map();
	for (const pkg of packages) {
		const printed = execFileSync(
			"npm",
			["pack", "--pack-destination", packDir, "--loglevel=error"],
			{ cwd: join(repoRoot, pkg.dir), encoding: "utf8" },
		)
			.trim()
			.split("\n")
			.pop()
			.trim();
		tarballs.set(pkg.name, join(packDir, printed));
	}
	return tarballs;
};
