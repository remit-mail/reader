import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	projectsOf,
	strayFiles,
	uncoveredFiles,
} from "./typecheck-coverage.mjs";

describe("projectsOf", () => {
	it("defaults to tsconfig.json for a bare tsgo run", () => {
		assert.deepEqual(projectsOf("tsgo --noEmit"), ["tsconfig.json"]);
	});

	it("reads the project a -p or --project names", () => {
		assert.deepEqual(projectsOf("tsgo --noEmit -p tsconfig.node.json"), [
			"tsconfig.node.json",
		]);
		assert.deepEqual(projectsOf("tsc --project tsconfig.build.json"), [
			"tsconfig.build.json",
		]);
	});

	it("collects every config a chained command runs", () => {
		assert.deepEqual(
			projectsOf(
				"npm run generate:routes && tsgo --noEmit && tsgo --noEmit -p tsconfig.node.json",
			),
			["tsconfig.json", "tsconfig.node.json"],
		);
	});

	it("credits nothing to a step that only mentions the compiler", () => {
		// The name appearing in an argument is not the compiler running. Crediting
		// it would report a config as enforced by a script that never invokes it.
		assert.deepEqual(projectsOf("node tsc-report.mjs"), []);
		assert.deepEqual(projectsOf("echo tsgo"), []);
	});

	it("credits nothing to a step whose failure is swallowed", () => {
		// `|| true` compiles the same files and enforces none of them.
		assert.deepEqual(projectsOf("tsgo --noEmit || true"), []);
	});

	it("ignores a step that is not the compiler at all", () => {
		assert.deepEqual(projectsOf("npm run generate:routes"), []);
	});
});

describe("strayFiles", () => {
	it("names files outside packages/, which no workspace script reaches", () => {
		assert.deepEqual(
			strayFiles([
				"packages/backend/src/index.ts",
				"apisix/generate-config.ts",
				"e2e/src/api.ts",
			]),
			["apisix/generate-config.ts", "e2e/src/api.ts"],
		);
	});

	it("passes a tree with everything under packages/", () => {
		assert.deepEqual(strayFiles(["packages/ui/src/button.tsx"]), []);
	});
});

describe("uncoveredFiles", () => {
	it("names a file inside a package that no config compiles", () => {
		assert.deepEqual(
			uncoveredFiles(
				["packages/web/src/app.ts", "packages/web/vite.config.ts"],
				["packages/web/src/app.ts"],
			),
			["packages/web/vite.config.ts"],
		);
	});

	it("passes when every file is compiled", () => {
		const files = ["packages/web/src/app.ts"];
		assert.deepEqual(uncoveredFiles(files, files), []);
	});
});
