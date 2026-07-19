#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(root, "packages");

async function countTestFiles(dir) {
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
async function discoverWorkspaces() {
	const names = await readdir(packagesDir);
	const found = [];
	const skipped = [];
	for (const name of names) {
		const dir = join(packagesDir, name);
		if (!(await stat(dir)).isDirectory()) continue;
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
		if (!manifest.scripts?.["test:run"]) {
			skipped.push(`${name} (no test:run script)`);
			continue;
		}
		found.push({ name, weight: await countTestFiles(join(dir, "src")) });
	}
	if (found.length === 0) {
		throw new Error("no workspaces with a test:run script were found");
	}
	if (skipped.length > 0) {
		console.log(`no tests to run for: ${skipped.join(", ")}`);
	}
	return found.sort((a, b) => b.weight - a.weight);
}

function runWorkspace(name) {
	return new Promise((resolve) => {
		const started = Date.now();
		execFile(
			"npm",
			["run", "test:run", "-w", `packages/${name}`],
			{ cwd: root, maxBuffer: 64 * 1024 * 1024 },
			(error, stdout, stderr) => {
				resolve({
					name,
					ok: !error,
					ms: Date.now() - started,
					output: `${stdout}${stderr}`,
				});
			},
		);
	});
}

async function main() {
	const workspaces = await discoverWorkspaces();
	const requested = Number.parseInt(process.env.TEST_CONCURRENCY ?? "", 10);
	const limit = Number.isNaN(requested)
		? Math.max(1, Math.min(availableParallelism(), 4))
		: Math.max(1, requested);
	const queue = [...workspaces];
	const results = [];

	const worker = async () => {
		for (;;) {
			const next = queue.shift();
			if (!next) return;
			const result = await runWorkspace(next.name);
			results.push(result);
			console.log(
				`${result.ok ? "PASS" : "FAIL"} ${result.name} (${(result.ms / 1000).toFixed(1)}s)`,
			);
		}
	};

	const started = Date.now();
	await Promise.all(Array.from({ length: limit }, worker));

	const failed = results.filter((result) => !result.ok);
	for (const result of failed) {
		console.log(`\n::group::${result.name} output`);
		console.log(result.output);
		console.log("::endgroup::");
	}

	console.log(
		`\n${results.length - failed.length}/${results.length} workspaces passed in ${((Date.now() - started) / 1000).toFixed(1)}s (concurrency ${limit})`,
	);

	if (failed.length > 0) {
		console.log(`failing workspaces: ${failed.map((r) => r.name).join(", ")}`);
		process.exitCode = 1;
	}
}

await main();
