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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertCodegenRan,
	packClosure,
	remitClosure,
} from "./lib/remit-closure.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, opts = {}) =>
	execFileSync(cmd, args, { encoding: "utf8", ...opts });

// The package whose types the consumer imports. Its transitive @remit closure —
// workspace packages under packages/ and generated packages under build/ — is
// packed alongside it; only third-party and @types dependencies resolve off
// the registry.
const IMPORTED = "@remit/backend";

const withTempDir = (fn) => {
	const dir = mkdtempSync(join(tmpdir(), "remit-consumer-tc-"));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

const { workspace, generated } = remitClosure(repoRoot, IMPORTED);
assertCodegenRan(repoRoot, generated);

withTempDir((tmp) => {
	const packDir = join(tmp, "tarballs");
	mkdirSync(packDir);

	// Pack the current-tree manifests — workspace packages from packages/, the
	// generated packages this tree's codegen produced from build/. The `*`
	// inter-package ranges are satisfied by the co-installed tarballs; only
	// third-party and @types deps come off the registry.
	const tarballs = [
		...packClosure(repoRoot, [...workspace, ...generated], packDir).values(),
	];

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
