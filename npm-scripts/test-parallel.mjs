#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const packagesDir = join(root, "packages");

async function countTestFiles(dir) {
	let total = 0;
	const walk = async (current) => {
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			return;
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

async function discoverWorkspaces() {
	const names = await readdir(packagesDir);
	const found = [];
	for (const name of names) {
		const dir = join(packagesDir, name);
		if (!(await stat(dir)).isDirectory()) continue;
		let manifest;
		try {
			manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
		} catch {
			continue;
		}
		if (!manifest.scripts?.["test:run"]) continue;
		found.push({ name, weight: await countTestFiles(join(dir, "src")) });
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
		process.exit(1);
	}
}

await main();
