#!/usr/bin/env node
import { execFile } from "node:child_process";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	discoverWorkspaces,
	WORKSPACE_SCRIPT,
} from "./lib/workspace-suites.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function runUnit({ name, command: [file, args] }) {
	return new Promise((resolve) => {
		const started = Date.now();
		execFile(
			file,
			args,
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
	const exclude = (process.env.TEST_EXCLUDE ?? "")
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	const { suites, skipped } = await discoverWorkspaces(root, { exclude });
	if (skipped.length > 0) {
		console.log(`no tests to run for: ${skipped.join(", ")}`);
	}
	const units = suites
		.map((suite) => ({
			...suite,
			command: ["npm", ["run", WORKSPACE_SCRIPT, "-w", suite.workspace]],
		}))
		.sort((a, b) => b.weight - a.weight);
	const requested = Number.parseInt(process.env.TEST_CONCURRENCY ?? "", 10);
	const limit = Number.isNaN(requested)
		? Math.max(1, Math.min(availableParallelism(), 4))
		: Math.max(1, requested);
	const queue = [...units];
	const results = [];

	const worker = async () => {
		for (;;) {
			const next = queue.shift();
			if (!next) return;
			const result = await runUnit(next);
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
		`\n${results.length - failed.length}/${results.length} suites passed in ${((Date.now() - started) / 1000).toFixed(1)}s (concurrency ${limit})`,
	);

	if (failed.length > 0) {
		console.log(`failing suites: ${failed.map((r) => r.name).join(", ")}`);
		process.exitCode = 1;
	}
}

await main();
