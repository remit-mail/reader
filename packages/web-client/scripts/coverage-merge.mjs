#!/usr/bin/env node
// Merges the LCOV each web-client shard emits and enforces the line floor once,
// on the union of shards. A shard measures only the files its own tests loaded,
// so no shard can enforce the floor: a line left uncovered in one shard is
// covered by another whose tests exercised that path. The merged figure gates
// every pull request exactly as the native single-process `test:run` floor did.
//
// Coverage is unioned per (file, line): a line counts as hit if any shard hit
// it, and each line is counted once no matter how many shards loaded the file.
// Summing shards instead would multi-count every shared module — a util
// imported by tests in all four shards would have its lines counted four times.
// The union is shard-count invariant: distributing the same test files across
// more or fewer shards moves which shard hits a line but never which lines exist
// or are hit, so the merged number is a property of the suite, not the fan-out.
//
// This lands ~0.5 point above the figure native `test:run` prints. node runs the
// whole suite in one process and, for the few modules it loads under more than
// one form (the loader stubs amplify-config, cognito-token and app-info), emits
// several LCOV blocks for the same lines and sums them, inflating its own
// denominator; the union counts those lines once. The gate is the honest
// deduplicated coverage and stays within a point of the native print.
import { readFileSync } from "node:fs";

// The floor the native runner enforced before sharding
// (packages/web-client/package.json test:run, --test-coverage-lines). Keep the
// two in lockstep: this gates every pull request exactly as the native flag did.
const LINE_FLOOR = 86;

function mergeLcov(text, files) {
	let lines = null;
	for (const raw of text.split("\n")) {
		if (raw.startsWith("SF:")) {
			const path = raw.slice(3).trim();
			lines = files.get(path);
			if (!lines) {
				lines = new Map();
				files.set(path, lines);
			}
			continue;
		}
		if (raw.startsWith("DA:") && lines) {
			const [line, hits] = raw
				.slice(3)
				.split(",")
				.map((value) => Number.parseInt(value, 10));
			lines.set(line, Math.max(lines.get(line) ?? 0, hits));
			continue;
		}
		if (raw === "end_of_record") lines = null;
	}
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
	throw new Error("usage: coverage-merge.mjs <shard.lcov>...");
}

const files = new Map();
for (const file of inputs) {
	mergeLcov(readFileSync(file, "utf8"), files);
}
if (files.size === 0) {
	throw new Error(
		`no coverage records found across ${inputs.length} lcov files`,
	);
}

let found = 0;
let hit = 0;
for (const lines of files.values()) {
	for (const hits of lines.values()) {
		found += 1;
		if (hits > 0) hit += 1;
	}
}

const pct = (hit / found) * 100;
console.log(
	`web-client merged line coverage: ${pct.toFixed(2)}% (${hit}/${found}) across ${files.size} files from ${inputs.length} shards`,
);

if (pct < LINE_FLOOR) {
	console.error(
		`::error::merged line coverage ${pct.toFixed(2)}% is below the ${LINE_FLOOR}% floor`,
	);
	process.exit(1);
}
console.log(`floor ${LINE_FLOOR}% met`);
