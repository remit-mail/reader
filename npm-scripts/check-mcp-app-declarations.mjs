#!/usr/bin/env node
// The published `@remit/mcp-server/app` declarations must typecheck in a host
// without Node (a Cloudflare Worker). mcp-app-entry.test.mjs proves the value
// graph; this proves the type graph a consumer's compiler loads: it emits the
// package's declarations as `npm pack` does and walks them from
// `dist/app-entry.d.ts`, into every workspace package that publishes source. A
// reachable Node builtin or auth-service root would put
// `@types/node` into the host's typecheck (#1581).
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { declarationGraph } from "./lib/declaration-graph.mjs";
import {
	FORBIDDEN_PACKAGES,
	isForbiddenPackage,
} from "./lib/mcp-app-entry.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(repoRoot, "packages", "mcp-server");
const outDir = join(repoRoot, ".tmp", "mcp-app-declarations");

const FORBIDDEN_BUILTINS = new Set(
	builtinModules.flatMap((name) => [name, `node:${name}`]),
);
const FORBIDDEN_TYPE_PACKAGES = [...FORBIDDEN_PACKAGES, "@types/node"];

const isForbidden = (spec) =>
	spec.startsWith("node:") ||
	FORBIDDEN_BUILTINS.has(spec) ||
	isForbiddenPackage(spec, FORBIDDEN_TYPE_PACKAGES);

rmSync(outDir, { recursive: true, force: true });
try {
	execFileSync(
		join(repoRoot, "node_modules/.bin/tsc"),
		["-p", "tsconfig.build.json", "--emitDeclarationOnly", "--outDir", outDir],
		{ cwd: pkgDir, stdio: "inherit" },
	);
	const { specifiers, files } = declarationGraph(
		repoRoot,
		join(outDir, "app-entry.d.ts"),
		outDir,
	);
	if (!files.includes("auth/authorization-server.d.ts"))
		throw new Error("the walk did not reach auth/authorization-server.d.ts");
	const leaks = [...specifiers]
		.filter(([spec]) => isForbidden(spec))
		.map(([spec, importers]) => `  ${spec} <- ${[...importers].join(", ")}`);
	if (leaks.length > 0) {
		console.error(
			`@remit/mcp-server/app declarations reach Node-only modules:\n${leaks.join("\n")}`,
		);
		process.exitCode = 1;
	} else {
		console.log(
			`@remit/mcp-server/app declarations: ${files.length} files, no Node-only module`,
		);
	}
} finally {
	rmSync(outDir, { recursive: true, force: true });
}
