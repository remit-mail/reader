// Shared analysis for the publish-closure guard.
//
// A published @remit/* package ships raw source (its `exports`/`main` point at
// `.ts`/`.tsx`). A registry consumer therefore compiles and bundles those
// sources directly, but never receives the package's devDependencies. So every
// module the shipped sources reach at runtime — third-party libraries and the
// `@types/*` packages needed to typecheck those sources — must be declared in
// `dependencies` or `peerDependencies`, not `devDependencies`.
//
// The tarball ships the whole `src` tree, so the scan reads every non-test file
// under it and collects the bare specifiers it imports. Test, spec, stories and
// `test-*` harness files are the build-only surface and are skipped, so their
// imports stay dev.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CODE_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

// Asset and virtual imports a frontend package makes (`./styles.css`,
// `logo.svg?url`, `virtual:…`). They carry no runtime module to declare.
const isAsset = (spec) =>
	/\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|json|html|txt|md|wasm)(\?.*)?$/.test(
		spec,
	) ||
	spec.startsWith("virtual:") ||
	spec.includes("?raw") ||
	spec.includes("?url");

const packageNameOf = (spec) => {
	const parts = spec.split("/");
	return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

// `@aws-sdk/client-kms` -> `@types/aws-sdk__client-kms`; `pg` -> `@types/pg`.
export const typesPackageOf = (name) =>
	name.startsWith("@")
		? `@types/${name.slice(1).replace("/", "__")}`
		: `@types/${name}`;

const stripComments = (source) =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:'"])\/\/[^\n]*/g, "$1");

// Extract module specifiers from genuine import/export statements only, tagging
// each as a value import or a type-only one (`import type …`, `export type …`).
// A bare `from`/`require` token — a SQL `from`, a `Buffer.from(…)` call — never
// matches: the keyword must open an actual import/export or a dynamic
// `import(…)`/`require(…)` call, and the intervening clause may not cross a
// quote or `;`, so a preceding statement can't leak into the specifier.
export const importSpecifiers = (raw) => {
	const source = stripComments(raw);
	const out = [];
	const typeOnly = [
		// import type … from "x"  /  export type … from "x"
		/\b(?:import|export)\s+type\s+(?:[^"';]+\s+from\s+)?["']([^"']+)["']/g,
	];
	const value = [
		// import … from "x"  and  import "x"  (not `import type …`)
		/\bimport\s+(?!type\s)(?:[^"';]+\s+from\s+)?["']([^"']+)["']/g,
		// export … from "x"  (not `export type …`)
		/\bexport\s+(?!type\s)[^"';]*\bfrom\s+["']([^"']+)["']/g,
		// import("x") and require("x")
		/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g,
	];
	for (const re of typeOnly)
		for (const m of source.matchAll(re))
			out.push({ spec: m[1], typeOnly: true });
	for (const re of value)
		for (const m of source.matchAll(re))
			out.push({ spec: m[1], typeOnly: false });
	return out;
};

// Directories and file names that hold test/build scaffolding, never shipped
// runtime. `foo.test.ts`, a `__tests__/` dir, and `test-db.ts`/`test-helpers.ts`
// support harnesses all import dev-only tooling (a test database, a schema
// pusher) that a consumer never runs.
const TEST_DIR = /^(__tests__|__mocks__|tests?|fixtures|mocks)$/;
const isTestSupport = (name) =>
	/\.(test|spec|stories)\.[a-z]+$/.test(name) || /^test[-.]/.test(name);

const sourceFiles = (dir) => {
	const out = [];
	const walk = (current) => {
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name === "node_modules") continue;
			const path = join(current, entry.name);
			if (entry.isDirectory()) {
				if (!TEST_DIR.test(entry.name)) walk(path);
				continue;
			}
			if (!CODE_EXT.some((ext) => entry.name.endsWith(ext))) continue;
			if (isTestSupport(entry.name)) continue;
			out.push(path);
		}
	};
	walk(dir);
	return out;
};

// Every third-party module the package's shipped runtime source imports, split
// into modules imported for a runtime value and modules imported only for their
// types. The tarball ships the whole `src` tree, so a consumer that compiles or
// bundles the package reaches every non-test file in it — not only the `exports`
// entry points. Test/spec/stories files are the build-only surface and stay dev.
export const reachedThirdParty = (_manifest, pkgDir) => {
	const values = new Set();
	const typeOnly = new Set();
	const skip = (spec) =>
		spec.startsWith("node:") ||
		spec.startsWith(".") ||
		spec.startsWith("@/") ||
		spec.startsWith("#") ||
		isAsset(spec);
	for (const file of sourceFiles(join(pkgDir, "src"))) {
		let text;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const { spec, typeOnly: isType } of importSpecifiers(text)) {
			if (skip(spec)) continue;
			(isType ? typeOnly : values).add(packageNameOf(spec));
		}
	}
	// A module imported for a value anywhere is a value import overall.
	for (const name of values) typeOnly.delete(name);
	return { values, typeOnly };
};

export const loadWorkspace = (repoRoot) => {
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
	return { workspaceNames, manifests };
};

// The full set of violations for one publishable package.
export const closureViolations = ({
	manifest,
	pkgDir,
	workspaceNames,
	manifests,
	repoRoot,
}) => {
	const runtimeDeclared = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	]);
	const declaredAnywhere = new Set([
		...runtimeDeclared,
		...Object.keys(manifest.devDependencies ?? {}),
	]);
	const { values, typeOnly } = reachedThirdParty(manifest, pkgDir);

	const undeclared = [];
	const closed = [];
	const missingTypes = [];

	const noteClosed = (name) => {
		if (name.startsWith("@remit/")) {
			if (workspaceNames.get(name) && manifests.get(name)?.private)
				closed.push(name);
			return true;
		}
		return false;
	};

	// A module imported for a runtime value must be installed for the consumer to
	// resolve it — declare it (or its @types if it is a types-only package).
	for (const name of values) {
		if (noteClosed(name)) continue;
		if (!runtimeDeclared.has(name)) undeclared.push(name);
		const typesName = typesPackageOf(name);
		if (
			typesName !== name &&
			declaredAnywhere.has(typesName) &&
			!runtimeDeclared.has(typesName)
		)
			missingTypes.push(typesName);
	}

	// A type-only import needs the declarations to resolve, not a runtime install.
	// If a matching `@types/*` package exists it must be declared; otherwise the
	// module ships its own types and must itself be declared.
	for (const name of typeOnly) {
		if (noteClosed(name)) continue;
		if (name.startsWith("@types/")) {
			if (!runtimeDeclared.has(name)) missingTypes.push(name);
			continue;
		}
		const typesName = typesPackageOf(name);
		if (declaredAnywhere.has(typesName)) {
			if (!runtimeDeclared.has(typesName)) missingTypes.push(typesName);
			continue;
		}
		if (!runtimeDeclared.has(name)) undeclared.push(name);
	}

	return {
		undeclared: [...new Set(undeclared)].sort(),
		missingTypes: [...new Set(missingTypes)].sort(),
		closed: [...new Set(closed)].sort(),
	};
};
