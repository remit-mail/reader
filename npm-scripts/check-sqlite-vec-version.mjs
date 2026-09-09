#!/usr/bin/env node
/**
 * Fail when the two sqlite-vec pins have drifted apart. See
 * `lib/sqlite-vec-lockstep.mjs` for what a divergence does to vec.db.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	findVersionDivergence,
	readDockerfileVersion,
	readWorkerLockVersion,
	readWorkerVersion,
} from "./lib/sqlite-vec-lockstep.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const dockerfileVersion = readDockerfileVersion(
	readFileSync(join(repoRoot, "Dockerfile"), "utf8"),
);
const workerPin = readWorkerVersion(
	readFileSync(
		join(repoRoot, "docker/runtime/search-index-worker/package.json"),
		"utf8",
	),
);

const workerLockVersion = readWorkerLockVersion(
	readFileSync(
		join(repoRoot, "docker/runtime/search-index-worker/package-lock.json"),
		"utf8",
	),
);

const divergence = findVersionDivergence({
	dockerfileVersion,
	workerPin,
	workerLockVersion,
});
if (divergence) {
	console.error(divergence);
	process.exit(1);
}

console.log(`sqlite-vec: ${dockerfileVersion} in both images`);
