#!/usr/bin/env node
// Runs one deterministic slice of the web-client test suite so the whole suite
// can fan out across CI runners. The native `test:run` measures coverage in a
// single process and enforces the 86% line floor on the union; a shard cannot,
// because it only sees the files its own tests load. So a shard emits node's own
// LCOV coverage (node's line arithmetic, not a third-party reinterpretation of
// the raw V8 output — those diverge from the native figure by several points)
// and enforces no floor. coverage-merge.mjs sums every shard's LCOV and checks
// the floor once, on the same blocks the native single-process runner measured.
//
// Partitioning is by descending file size into the lightest bin (greedy), so
// the slowest shard is as light as the set allows and assignment is a pure
// function of the discovered file list — every shard computes the same bins and
// claims exactly one, with no overlap and no gaps.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function discoverTestFiles(dir) {
	const found = [];
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
				found.push(full);
			}
		}
	};
	walk(dir);
	return found;
}

function binFor(files, total, index) {
	const weighted = files
		.map((file) => ({ file, size: statSync(file).size }))
		.sort((a, b) => b.size - a.size || a.file.localeCompare(b.file));
	const bins = Array.from({ length: total }, () => ({ load: 0, files: [] }));
	for (const { file, size } of weighted) {
		const lightest = bins.reduce((min, bin) =>
			bin.load < min.load ? bin : min,
		);
		lightest.load += size;
		lightest.files.push(file);
	}
	return bins[index].files.sort();
}

function positiveInt(name) {
	const value = Number.parseInt(process.env[name] ?? "", 10);
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(
			`${name} must be a positive integer, got ${process.env[name]}`,
		);
	}
	return value;
}

const total = positiveInt("SHARD_TOTAL");
const index = positiveInt("SHARD_INDEX");
if (index > total) {
	throw new Error(
		`SHARD_INDEX ${index} is out of range for SHARD_TOTAL ${total}`,
	);
}

const allFiles = discoverTestFiles(join(packageRoot, "src"));
const files = binFor(allFiles, total, index - 1);
if (files.length === 0) {
	throw new Error(
		`shard ${index}/${total} selected no files from ${allFiles.length} discovered — bins outnumber test files`,
	);
}

const lcovPath = resolve(
	process.env.SHARD_LCOV ??
		join(packageRoot, "coverage", `shard-${index}.lcov`),
);
mkdirSync(dirname(lcovPath), { recursive: true });

const relFiles = files.map((file) => relative(packageRoot, file));
console.log(
	`shard ${index}/${total}: ${relFiles.length} of ${allFiles.length} test files, lcov -> ${lcovPath}`,
);

const child = spawn(
	process.execPath,
	[
		"--import",
		"tsx",
		"--import",
		"./test-support/register.mjs",
		"--experimental-test-coverage",
		"--test-coverage-include=src/**",
		"--test-coverage-exclude=src/**/*.test.ts",
		"--test-coverage-exclude=src/**/*.test.tsx",
		"--test-coverage-exclude=src/test-support/**",
		"--test-reporter=spec",
		"--test-reporter-destination=stdout",
		"--test-reporter=lcov",
		`--test-reporter-destination=${lcovPath}`,
		"--test",
		...relFiles,
	],
	{ cwd: packageRoot, stdio: "inherit" },
);

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});
