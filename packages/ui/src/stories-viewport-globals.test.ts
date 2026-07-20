import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Storybook 9 dropped `parameters.viewport.defaultViewport` (the Storybook
 * 6/7 API) — it is silently ignored, so a story written against it renders
 * full width instead of the intended breakpoint. The replacement is a
 * per-story viewport global: `globals: { viewport: { value: "mobile" } }`
 * (#67, #68).
 */

const here = dirname(fileURLToPath(import.meta.url));

const storyFiles = (root: string): string[] => {
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory() && entry.name !== "node_modules") {
				walk(resolve(dir, entry.name));
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".stories.tsx")) {
				found.push(resolve(dir, entry.name));
			}
		}
	};
	walk(root);
	return found;
};

describe("story files use the viewport globals pattern (#68)", () => {
	const roots = [here, resolve(here, "../../workbench/src")];

	it("scans at least one story file", () => {
		const files = roots.flatMap((root) => storyFiles(root));
		assert.ok(files.length > 0);
	});

	it("never references parameters.viewport.defaultViewport", () => {
		const offenders = roots
			.flatMap((root) => storyFiles(root))
			.filter((file) => readFileSync(file, "utf8").includes("defaultViewport"))
			.map((file) => relative(here, file));
		assert.deepEqual(offenders, []);
	});
});
