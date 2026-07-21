// Discovery for the root tooling's own suites, shared by the runner that
// executes them (npm-scripts/test-parallel.mjs) and the guard that proves they
// are reachable (npm-scripts/check-ci-coverage.mjs). One walk, two callers: a
// suite the runner would miss is a suite the guard also reports, so the two can
// never disagree about what CI covers.
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export const SCRIPTS_DIR = "npm-scripts";

export async function discoverScriptSuites(root) {
	const scriptsDir = join(root, SCRIPTS_DIR);
	const files = [];
	const walk = async (current) => {
		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name === "node_modules") continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (entry.name.endsWith(".test.mjs")) files.push(relative(root, full));
		}
	};
	await walk(scriptsDir);
	// Finding none means the walk broke, not that the tooling stopped being
	// tested. Reporting zero suites as success is the failure this file exists
	// to prevent.
	if (files.length === 0) {
		throw new Error(`no *.test.mjs suites found under ${scriptsDir}`);
	}
	return files.sort();
}
