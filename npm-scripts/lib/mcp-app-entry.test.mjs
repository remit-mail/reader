// `@remit/mcp-server/app` is what a host without Node (a Cloudflare Worker)
// composes, so its value-import graph must reach none of the Node and AWS
// modules the VPS composition root (`src/main.ts`) wires in (#1581).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { importGraph } from "./import-graph.mjs";
import { isForbiddenPackage } from "./mcp-app-entry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(
	readFileSync(join(ROOT, "packages", "mcp-server", "package.json"), "utf8"),
);

// A Worker's nodejs_compat covers crypto, buffer, stream and util, which the
// mail services import; it has no file system, timers module or HTTP server.
const NODE_ONLY_BUILTINS = new Set(["fs", "timers", "http"]);
const FORBIDDEN_BUILTINS = builtinModules
	.filter((name) => NODE_ONLY_BUILTINS.has(name.split("/")[0]))
	.flatMap((name) => [name, `node:${name}`]);

const isForbidden = (spec) =>
	FORBIDDEN_BUILTINS.includes(spec) || isForbiddenPackage(spec);

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

	it("knows the Node-only builtins it refuses", () => {
		for (const spec of [
			"fs",
			"node:fs/promises",
			"node:timers/promises",
			"http",
		])
			assert.ok(isForbidden(spec), spec);
	});

	it("imports no Node-only or AWS module", () => {
		const leaks = [...specifiers]
			.filter(([spec]) => isForbidden(spec))
			.map(([spec, importers]) => `${spec} <- ${[...importers].join(", ")}`);
		assert.deepEqual(leaks, []);
	});
});
