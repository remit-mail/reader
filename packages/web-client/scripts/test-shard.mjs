#!/usr/bin/env node
// Runs one deterministic slice of the web-client test suite so the whole suite
// can fan out across CI runners. The native `test:run` measures coverage in a
// single process and enforces the 86% line floor on the union; a shard cannot,
// because it only sees the files its own tests load. So a shard emits node's own
// LCOV coverage (node's line arithmetic, not a third-party reinterpretation of
// the raw V8 output — those diverge from the native figure by several points)
// and enforces no floor. coverage-merge.mjs unions every shard's LCOV per line
// and checks the floor once.
//
// Partitioning is by descending file size into the lightest bin (greedy), so
// the slowest shard is as light as the set allows and assignment is a pure
// function of the discovered file list — every shard computes the same bins and
// claims exactly one, with no overlap and no gaps.
//
// The gate is only as complete as the file discovery: a test the walk misses
// vanishes from both the sharded run and the merged floor with nothing failing.
// Two guards make that loud — the walk is cross-checked against an independent
// glob, and the partition is checked to assign exactly the discovered set.
import { spawn } from "node:child_process";
import { globSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeTestArgs } from "../../../npm-scripts/lib/test-bounds.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_FILE_SUFFIXES = [".test.ts", ".test.tsx"];
const PRUNED_DIRS = new Set(["node_modules", "dist"]);

function discoverTestFiles(dir) {
	const found = [];
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (PRUNED_DIRS.has(entry.name)) continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (TEST_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
				found.push(full);
			}
		}
	};
	walk(dir);
	return found.sort();
}

// Independent of the walk above (node's own globbing), so a future edit that
// narrows one but not the other fails here instead of silently dropping files.
function globTestFiles(dir) {
	return TEST_FILE_SUFFIXES.flatMap((suffix) =>
		globSync(`**/*${suffix}`, { cwd: dir }),
	)
		.filter(
			(rel) => !rel.split("/").some((segment) => PRUNED_DIRS.has(segment)),
		)
		.map((rel) => join(dir, rel))
		.sort();
}

function partition(files, total) {
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
	return bins.map((bin) => bin.files.sort());
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

const srcDir = join(packageRoot, "src");
const allFiles = discoverTestFiles(srcDir);

const globbed = globTestFiles(srcDir);
if (
	allFiles.length !== globbed.length ||
	allFiles.some((file, i) => file !== globbed[i])
) {
	throw new Error(
		`test-file discovery disagrees with an independent glob: the walk found ${allFiles.length} files, the glob found ${globbed.length} — one of them is missing a suffix or pruning a directory the other keeps`,
	);
}

const bins = partition(allFiles, total);
const assigned = bins.reduce((sum, bin) => sum + bin.length, 0);
if (assigned !== allFiles.length) {
	throw new Error(
		`partition assigned ${assigned} files but ${allFiles.length} were discovered — the bins drop or duplicate files`,
	);
}

const files = bins[index - 1];
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
		...nodeTestArgs(),
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
	{
		cwd: packageRoot,
		stdio: "inherit",
		// The same config `test:run` uses, so a shard compiles a shared
		// @remit/ui component the way the app's own build does.
		env: { ...process.env, TSX_TSCONFIG_PATH: "./tsconfig.test.json" },
	},
);

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});
