#!/usr/bin/env node
/**
 * Fail when the sqlite-vec pin stops being one version across the two builds.
 * See `lib/sqlite-vec-lockstep.mjs` for what a divergence does to vec.db.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	findVersionDivergence,
	readDockerfilePinSource,
	readWorkerLockVersion,
	readWorkerVersion,
} from "./lib/sqlite-vec-lockstep.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const manifestPath = readDockerfilePinSource(
	readFileSync(join(repoRoot, "Dockerfile"), "utf8"),
);
const workerPin = readWorkerVersion(
	readFileSync(join(repoRoot, manifestPath), "utf8"),
);

const workerLockVersion = readWorkerLockVersion(
	readFileSync(
		join(repoRoot, "docker/runtime/search-index-worker/package-lock.json"),
		"utf8",
	),
);

const divergence = findVersionDivergence({
	workerPin,
	workerLockVersion,
});
if (divergence) {
	console.error(divergence);
	process.exit(1);
}

console.log(
	`sqlite-vec: ${workerPin} in both images (the musl build compiles the worker manifest's pin)`,
);
