#!/usr/bin/env node
// Compiles the TypeScript @hey-api/openapi-ts writes into build/remit-client to
// JavaScript and declarations in build/remit-client/dist, and writes the
// manifest that publishes only that output. A consumer then imports the client
// from node_modules with plain Node, no TypeScript loader. The `./*.ts` subpath
// keeps the source-file paths consumers already import resolving to the
// compiled files.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = join(repoRoot, "build/remit-client");

const tsconfig = {
	compilerOptions: {
		target: "ES2022",
		module: "NodeNext",
		moduleResolution: "NodeNext",
		lib: ["ES2022", "DOM", "DOM.Iterable"],
		declaration: true,
		outDir: "dist",
		rootDir: ".",
		skipLibCheck: true,
		strict: true,
	},
	include: ["**/*.ts"],
	exclude: ["dist", "node_modules"],
};

const manifest = {
	name: "@remit/api-http-client",
	version: "1.0.0",
	type: "module",
	sideEffects: false,
	main: "./dist/index.js",
	types: "./dist/index.d.ts",
	exports: {
		".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
		"./*.ts": { types: "./dist/*.d.ts", default: "./dist/*.js" },
		"./*.js": { types: "./dist/*.d.ts", default: "./dist/*.js" },
		"./package.json": "./package.json",
	},
	files: ["dist"],
};

writeFileSync(
	join(clientDir, "tsconfig.json"),
	`${JSON.stringify(tsconfig, null, 2)}\n`,
);
execFileSync("npx", ["tsc", "-p", clientDir], {
	cwd: repoRoot,
	stdio: "inherit",
});
writeFileSync(
	join(clientDir, "package.json"),
	`${JSON.stringify(manifest, null, 2)}\n`,
);
