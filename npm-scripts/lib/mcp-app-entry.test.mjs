// `@remit/mcp-server/app` is what a host without Node (a Cloudflare Worker)
// composes, so its value-import graph must reach none of the Node and AWS
// modules the VPS composition root (`src/main.ts`) wires in (#1581).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { importGraph, valueImports } from "./import-graph.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(
	readFileSync(join(ROOT, "packages", "mcp-server", "package.json"), "utf8"),
);

const FORBIDDEN = [
	/^@remit\/auth-service(?!\/constants$)/,
	/^@remit\/sqs-client(\/|$)/,
	/^@remit\/storage-service\/s3$/,
	/^@remit\/logger-lambda(\/|$)/,
	/^@remit\/drizzle-service(?!\/schema-sets\/mcp$)/,
	/^better-sqlite3$/,
	/^better-auth\/node$/,
	/^(node:)?(fs|timers|http)(\/|$)/,
];

describe("the @remit/mcp-server/app entry", () => {
	const entry = MANIFEST.exports["./app"].default;
	const { specifiers, files } = importGraph(
		ROOT,
		join("packages", "mcp-server", entry),
	);

	it("walks the tools, the auth server and the pages", () => {
		for (const file of [
			"packages/mcp-server/src/app.ts",
			"packages/mcp-server/src/folder-tools.ts",
			"packages/mcp-server/src/auth/authorization-server.ts",
			"packages/mcp-server/src/pages/views.tsx",
		]) {
			assert.ok(files.includes(file), `${file} is not in the graph`);
		}
	});

	it("imports no Node-only or AWS module", () => {
		const leaks = [...specifiers]
			.filter(([spec]) => FORBIDDEN.some((pattern) => pattern.test(spec)))
			.map(([spec, importers]) => `${spec} <- ${[...importers].join(", ")}`);
		assert.deepEqual(leaks, []);
	});
});

describe("valueImports", () => {
	it("skips imports that erase at build", () => {
		assert.deepEqual(
			valueImports(
				[
					'import type { A } from "erased-a";',
					'import { type B, type C } from "erased-b";',
					'export type { D } from "erased-c";',
					'import { type E, f } from "kept-a";',
					'export { g } from "kept-b";',
					'import "kept-c";',
					'const h = await import("kept-d");',
				].join("\n"),
			),
			["kept-a", "kept-b", "kept-c", "kept-d"],
		);
	});
});
