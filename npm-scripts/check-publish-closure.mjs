#!/usr/bin/env node
// Publish-closure guard. A published @remit/* package ships raw source — its
// `exports`/`main` point at `.ts`/`.tsx` — so a registry consumer compiles and
// bundles those sources directly and never receives the package's
// devDependencies. Every module the shipped source imports must therefore
// resolve off what the manifest declares as `dependencies`/`peerDependencies`:
//
//   1. a private workspace package must not be imported at all (it never
//      publishes, so its import would never resolve);
//   2. a third-party module imported for a runtime value must be declared;
//   3. the `@types/*` a shipped source needs to typecheck — for a type-only
//      import of a DefinitelyTyped module, or alongside a value import whose
//      types ship separately — must be declared too, not left in
//      devDependencies where the consumer never sees it.
//
// The scan walks the whole `src` tree (the tarball ships all of it), skipping
// only test/spec/stories and `test-*` harness files, whose imports stay dev. Run
// before publishing so a package whose imports do not resolve never ships.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closureViolations, loadWorkspace } from "./lib/publish-closure.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { workspaceNames, manifests } = loadWorkspace(repoRoot);
const publishable = [...manifests.values()].filter((m) => !m.private);

const offenders = [];
for (const manifest of publishable) {
	const pkgDir = join(repoRoot, workspaceNames.get(manifest.name));
	const { undeclared, missingTypes, closed } = closureViolations({
		manifest,
		pkgDir,
		workspaceNames,
		manifests,
		repoRoot,
	});
	if (undeclared.length || missingTypes.length || closed.length)
		offenders.push({ name: manifest.name, undeclared, missingTypes, closed });
}

if (offenders.length === 0) {
	console.log(
		`Publish closure OK: ${publishable.length} publishable packages, every imported module is declared.`,
	);
	process.exit(0);
}

console.error("Publish closure violations:\n");
for (const { name, undeclared, missingTypes, closed } of offenders) {
	console.error(`  ${name} (publishable):`);
	if (closed.length)
		console.error(`    imports private packages: ${closed.join(", ")}`);
	if (undeclared.length)
		console.error(
			`    imports undeclared third-party modules: ${undeclared.join(", ")}`,
		);
	if (missingTypes.length)
		console.error(
			`    needs @types in dependencies (not devDependencies): ${missingTypes.join(", ")}`,
		);
}
console.error(
	"\nMove each into dependencies (or peerDependencies where the consumer supplies it).\n" +
		"A private-package import must be cut, or the package kept private until the coupling is removed.",
);
process.exit(1);
