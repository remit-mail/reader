#!/usr/bin/env node
// Consumer-side typecheck acceptance. The publish guard proves every imported
// module is declared; this proves the declarations are *sufficient* to compile
// the shipped sources from a clean install — the case the static scan cannot
// see: an `@types/*` a source needs that is declared nowhere at all.
//
// It packs the workspace packages as they stand in this tree, alongside the
// TypeSpec-generated `@remit/*` packages this tree's own codegen produced into
// `build/` (see lib/generated-packages.mjs) — neither is an independently
// published artifact, so both must come from the local tree, not the registry.
// Only third-party and `@types` dependencies resolve off the registry. The
// packed set installs into a throwaway consumer, which then typechecks a
// trivial file that imports types from a heavy package. A missing `@types/*`
// surfaces as a TS2307/TS7016 and fails.
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED_PACKAGES } from "./lib/generated-packages.mjs";
import { loadWorkspace } from "./lib/publish-closure.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, opts = {}) =>
	execFileSync(cmd, args, { encoding: "utf8", ...opts });

// The package whose types the consumer imports. Its transitive @remit closure —
// workspace packages under packages/ and generated packages under build/ — is
// packed alongside it; only third-party and @types dependencies resolve off
// the registry.
const IMPORTED = "@remit/backend";

const { workspaceNames, manifests } = loadWorkspace(repoRoot);
const generatedByName = new Map(
	GENERATED_PACKAGES.map((pkg) => [pkg.name, pkg]),
);

// The @remit packages @remit/backend needs, transitively, split into workspace
// packages (live under packages/, packed from there) and generated packages
// (live under build/, produced by this tree's own codegen — packed from
// there). A @remit/* dependency that resolves to neither is unresolvable and
// fails loudly rather than silently falling back to the registry.
const remitClosure = (root) => {
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
// the registry instead, which is exactly the bug this check used to have.
const assertCodegenRan = (generated) => {
	const missing = generated.filter(
		(pkg) => !existsSync(join(repoRoot, pkg.dir, "package.json")),
	);
	if (missing.length === 0) return;
	console.error(
		"Consumer typecheck: missing generated package(s) — run `npm run codegen` " +
			"(or `make`) first:\n" +
			missing.map((pkg) => `  ${pkg.name} (expected at ${pkg.dir})`).join("\n"),
	);
	process.exit(1);
};

const withTempDir = (fn) => {
	const dir = mkdtempSync(join(tmpdir(), "remit-consumer-tc-"));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

const { workspace, generated } = remitClosure(IMPORTED);
assertCodegenRan(generated);

withTempDir((tmp) => {
	const packDir = join(tmp, "tarballs");
	mkdirSync(packDir);

	// Pack the current-tree manifests — workspace packages from packages/, the
	// generated packages this tree's codegen produced from build/. The `*`
	// inter-package ranges are satisfied by the co-installed tarballs; only
	// third-party and @types deps come off the registry.
	const tarballs = [];
	for (const pkg of [...workspace, ...generated]) {
		const printed = run(
			"npm",
			["pack", "--pack-destination", packDir, "--loglevel=error"],
			{ cwd: join(repoRoot, pkg.dir) },
		)
			.trim()
			.split("\n")
			.pop()
			.trim();
		tarballs.push(join(packDir, printed));
	}

	const consumer = join(tmp, "consumer");
	mkdirSync(consumer);
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify(
			{ name: "consumer", private: true, type: "module" },
			null,
			2,
		),
	);
	run(
		"npm",
		[
			"install",
			...tarballs,
			"typescript@^5.9.0",
			"@types/node",
			"--loglevel=error",
			"--no-audit",
			"--no-fund",
		],
		{ cwd: consumer, stdio: "inherit" },
	);

	writeFileSync(
		join(consumer, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					module: "NodeNext",
					moduleResolution: "NodeNext",
					target: "ES2022",
					strict: true,
					types: ["node"],
					esModuleInterop: true,
					skipLibCheck: true,
					noEmit: true,
				},
				files: ["consumer.ts"],
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(consumer, "consumer.ts"),
		`import * as Imported from "${IMPORTED}";\nexport type Probe = typeof Imported;\n`,
	);

	run(
		"node",
		[
			join(consumer, "node_modules", "typescript", "bin", "tsc"),
			"--noEmit",
			"-p",
			"tsconfig.json",
		],
		{
			cwd: consumer,
			stdio: "inherit",
		},
	);

	console.log(
		`Consumer typecheck OK: a clean install of ${IMPORTED} compiles a type import of it.`,
	);
});
