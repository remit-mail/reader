#!/usr/bin/env node
// Consumer-side typecheck acceptance. The publish guard proves every imported
// module is declared; this proves the declarations are *sufficient* to compile
// the shipped sources from a clean install — the case the static scan cannot
// see: an `@types/*` a source needs that is declared nowhere at all.
//
// It packs the workspace packages as they stand in this tree (so it tests the
// PR's manifests, not whatever is already on the registry), installs them into a
// throwaway consumer with their third-party and `@types` dependencies resolved
// off the registry, then typechecks a trivial file that imports types from a
// heavy package. A missing `@types/*` surfaces as a TS2307/TS7016 and fails.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "./lib/publish-closure.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, opts = {}) =>
	execFileSync(cmd, args, { encoding: "utf8", ...opts });

// The package whose types the consumer imports. Its transitive @remit workspace
// closure is packed alongside it; generated @remit/* and third-party/@types
// dependencies resolve off the registry.
const IMPORTED = "@remit/backend";

const { workspaceNames, manifests } = loadWorkspace(repoRoot);

// The workspace packages @remit/backend needs, transitively. Only packages that
// live under packages/ are packed here; generated @remit/* (build/) come off the
// registry like any other published dependency.
const workspaceClosure = (root) => {
	const seen = new Set();
	const visit = (name) => {
		if (seen.has(name) || !workspaceNames.has(name)) return;
		seen.add(name);
		const manifest = manifests.get(name);
		for (const dep of Object.keys(manifest.dependencies ?? {}))
			if (dep.startsWith("@remit/")) visit(dep);
	};
	visit(root);
	return [...seen].map((name) => ({ name, dir: workspaceNames.get(name) }));
};

const withTempDir = (fn) => {
	const dir = mkdtempSync(join(tmpdir(), "remit-consumer-tc-"));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

withTempDir((tmp) => {
	const packDir = join(tmp, "tarballs");
	mkdirSync(packDir);

	// Pack the current-tree manifests. The `*` inter-package ranges are satisfied
	// by the co-installed tarballs; generated @remit/* and third-party deps come
	// off the registry.
	const tarballs = [];
	for (const pkg of workspaceClosure(IMPORTED)) {
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
