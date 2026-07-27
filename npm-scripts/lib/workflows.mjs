// The workflow files, walked once and shared by everything that has to agree
// with them: the guard that proves every suite runs (check-ci-coverage.mjs) and
// the runner that proves no exclusion arrives by a route the guard cannot read
// (test-parallel.mjs). One walk, two callers, so the two can never be reading a
// different set of files.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export const WORKFLOWS_DIR = ".github";

// A tree with no `.github` reads as no workflows rather than as an error. The
// runner calls this on every `test:ci`, and a source tarball or a docker build
// context has no workflows to run the tests from — dying there would stop the
// suites over a check that has nothing to check. The guard calls it too, and
// answers "nothing CI reaches", which is loud on its own.
export async function readWorkflowSources(root) {
	const files = [];
	const walk = async (current) => {
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch (error) {
			if (error.code === "ENOENT") return;
			throw error;
		}
		for (const entry of entries) {
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
