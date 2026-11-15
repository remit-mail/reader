#!/usr/bin/env node
// Prints the spec files one e2e-dev shard runs, as Playwright file filters:
// `node npm-scripts/e2e-shard.mjs <shard> <total>`. The durations come from
// packages/e2e/spec-durations.json, seconds per spec measured on CI.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assignShards } from "./lib/e2e-shards.mjs";

const suiteDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"../packages/e2e",
);
const [shard, total] = process.argv.slice(2).map(Number);
if (!Number.isInteger(total) || total < 1 || !(shard >= 1 && shard <= total)) {
	console.error("usage: e2e-shard.mjs <shard> <total>, 1 <= shard <= total");
	process.exit(1);
}

const specs = readdirSync(join(suiteDir, "specs")).filter((name) =>
	name.endsWith(".spec.ts"),
);
const durations = JSON.parse(
	readFileSync(join(suiteDir, "spec-durations.json"), "utf8"),
);
const { specs: assigned } = assignShards(specs, durations, total)[shard - 1];

// An empty filter list makes Playwright run every spec, so an empty shard is an
// error rather than a shard that quietly runs the whole suite.
if (assigned.length === 0) {
	console.error(`shard ${shard}/${total} has no specs: lower the shard count`);
	process.exit(1);
}
console.log(assigned.map((spec) => `specs/${spec}`).join(" "));
