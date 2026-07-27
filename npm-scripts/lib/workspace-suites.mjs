// Discovery for the workspace suites, shared by the runner that executes them
// (npm-scripts/test-parallel.mjs) and the guard that proves every workspace test
// script is reachable (npm-scripts/check-ci-coverage.mjs). One walk, two
// callers: a suite the runner would miss is a suite the guard also reports, so
// the two can never disagree about what CI covers.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const WORKSPACE_SCRIPT = "test:run";

export async function countTestFiles(dir) {
	let total = 0;
	const walk = async (current) => {
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch (error) {
			if (error.code === "ENOENT") return;
			throw error;
		}
		for (const entry of entries) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
				total += 1;
			}
		}
	};
	await walk(dir);
	return total;
}

// A workspace that cannot be read is an error, never a silent skip: dropping a
// manifest here would quietly remove that workspace's whole suite from a run
// that still reports green.
export async function discoverWorkspaces(root, { exclude = [] } = {}) {
	const packagesDir = join(root, "packages");
	const excluded = new Set(exclude);
	const names = await readdir(packagesDir);
	for (const name of excluded) {
		if (!names.includes(name)) {
			throw new Error(
				`TEST_EXCLUDE names "${name}", which is not a workspace under packages/`,
			);
		}
	}
	const suites = [];
	const skipped = [];
	for (const name of names) {
		const dir = join(packagesDir, name);
		if (!(await stat(dir)).isDirectory()) continue;
		// A workspace whose suite runs elsewhere (web-client fans out across the
		// shard matrix) is excluded here so it is not run a second time. Named
		// rather than inferred: an unknown name in the list is a typo that would
		// silently drop nothing, so it must match a real workspace.
		if (excluded.has(name)) {
			skipped.push(`${name} (excluded)`);
			continue;
		}
		const manifestPath = join(dir, "package.json");
		let manifest;
		try {
			manifest = JSON.parse(await readFile(manifestPath, "utf8"));
		} catch (error) {
			if (error.code === "ENOENT") {
				skipped.push(`${name} (no package.json)`);
				continue;
			}
			throw new Error(`cannot read ${manifestPath}: ${error.message}`, {
				cause: error,
			});
		}
		const weight = await countTestFiles(join(dir, "src"));
		if (!manifest.scripts?.[WORKSPACE_SCRIPT]) {
			// Test files with no script to run them is the same silent hole as a
			// suite nothing collects: the workspace drops out of a green run.
			if (weight > 0) {
				throw new Error(
					`packages/${name} has ${weight} test files but no ${WORKSPACE_SCRIPT} script: add one, or delete the tests`,
				);
			}
			skipped.push(`${name} (no tests)`);
			continue;
		}
		suites.push({ name, weight, workspace: `packages/${name}` });
	}
	if (suites.length === 0) {
		throw new Error(
			`no workspaces with a ${WORKSPACE_SCRIPT} script were found`,
		);
	}
	return { suites, skipped };
}
