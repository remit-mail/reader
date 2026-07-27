import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { readWorkflowSources } from "./workflows.mjs";

const roots = [];
const root = () => {
	const dir = mkdtempSync(join(tmpdir(), "workflows-"));
	roots.push(dir);
	return dir;
};

after(() => {
	for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe("readWorkflowSources", () => {
	it("reads every workflow file under .github, nested ones included", async () => {
		const dir = root();
		mkdirSync(join(dir, ".github/workflows"), { recursive: true });
		mkdirSync(join(dir, ".github/actions/setup"), { recursive: true });
		writeFileSync(join(dir, ".github/workflows/ci.yml"), "name: CI\n");
		writeFileSync(join(dir, ".github/actions/setup/action.yml"), "name: setup\n");
		writeFileSync(join(dir, ".github/workflows/notes.md"), "ignored\n");

		const { files, sources } = await readWorkflowSources(dir);
		assert.deepEqual(files, [
			".github/actions/setup/action.yml",
			".github/workflows/ci.yml",
		]);
		assert.deepEqual(sources, ["name: setup\n", "name: CI\n"]);
	});

	// `test-parallel` calls this on every `test:ci`, so a tree with no workflows
	// — a source tarball, a docker build context — has to run its tests rather
	// than die on the walk.
	it("reads a tree with no .github as no workflows", async () => {
		const { files, sources } = await readWorkflowSources(root());
		assert.deepEqual(files, []);
		assert.deepEqual(sources, []);
	});
});
