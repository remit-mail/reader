// The workflow files, walked once and shared by everything that has to agree
// with them: the guard that proves every suite runs (check-ci-coverage.mjs) and
// the runner that proves no exclusion arrives by a route the guard cannot read
// (test-parallel.mjs). One walk, two callers, so the two can never be reading a
// different set of files.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export const WORKFLOWS_DIR = ".github";

export async function readWorkflowSources(root) {
	const files = [];
	const walk = async (current) => {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
				files.push(relative(root, full));
			}
		}
	};
	await walk(join(root, WORKFLOWS_DIR));
	files.sort();
	const sources = await Promise.all(
		files.map((file) => readFile(join(root, file), "utf8")),
	);
	return { files, sources };
}
