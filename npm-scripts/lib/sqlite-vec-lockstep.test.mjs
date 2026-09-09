import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	findVersionDivergence,
	readDockerfileVersion,
	readWorkerLockVersion,
	readWorkerVersion,
} from "./sqlite-vec-lockstep.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(join(repoRoot, ...parts), "utf8");

describe("reading the two pins", () => {
	test("takes the backend's version from the build ARG", () => {
		assert.equal(
			readDockerfileVersion(
				[
					"FROM alpine AS sqlite-vec-musl",
					"ARG SQLITE_VEC_VERSION=0.1.9",
					"",
				].join("\n"),
			),
			"0.1.9",
		);
	});

	test("refuses a Dockerfile that declares no version", () => {
		assert.throws(
			() => readDockerfileVersion("FROM alpine\nRUN apk add sqlite\n"),
			/ARG SQLITE_VEC_VERSION/,
		);
	});

	test("takes the worker's version from its runtime dependencies", () => {
		assert.equal(
			readWorkerVersion(
				JSON.stringify({ dependencies: { "sqlite-vec": "0.1.9" } }),
			),
			"0.1.9",
		);
	});

	test("refuses a worker image that pins nothing", () => {
		assert.throws(
			() => readWorkerVersion(JSON.stringify({ dependencies: {} })),
			/pins no sqlite-vec/,
		);
	});

	test("takes the installed version from the lockfile", () => {
		assert.equal(
			readWorkerLockVersion(
				JSON.stringify({
					packages: { "node_modules/sqlite-vec": { version: "0.1.9" } },
				}),
			),
			"0.1.9",
		);
	});

	test("refuses a lockfile that resolves nothing", () => {
		assert.throws(
			() => readWorkerLockVersion(JSON.stringify({ packages: {} })),
			/resolves no sqlite-vec/,
		);
	});
});

describe("findVersionDivergence", () => {
	test("passes two identical exact pins", () => {
		assert.equal(
			findVersionDivergence({
				dockerfileVersion: "0.1.9",
				workerPin: "0.1.9",
				workerLockVersion: "0.1.9",
			}),
			null,
		);
	});

	// `npm ci` installs the lockfile, so a lockfile that moved on its own is the
	// version the image runs whatever the manifest asks for.
	test("names the lockfile when it resolves a different version", () => {
		assert.match(
			findVersionDivergence({
				dockerfileVersion: "0.1.9",
				workerPin: "0.1.9",
				workerLockVersion: "0.1.10",
			}),
			/lockfile resolves 0\.1\.10/,
		);
	});

	test("names both sides when they differ", () => {
		const divergence = findVersionDivergence({
			dockerfileVersion: "0.1.9",
			workerPin: "0.1.10",
		});
		assert.match(divergence, /0\.1\.9 in the Dockerfile/);
		assert.match(divergence, /0\.1\.10 in the search-index-worker/);
	});

	// A range is a divergence that has not happened yet: the next image build
	// installs whatever npm resolves, and the amalgamation stays pinned.
	test("refuses a range even when it currently resolves to the same version", () => {
		for (const workerPin of ["^0.1.9", "~0.1.9"]) {
			assert.match(
				findVersionDivergence({ dockerfileVersion: "0.1.9", workerPin }),
				/Pin it exactly/,
			);
		}
	});
});

// The check itself, against the files that ship. The two builds share one
// vec.db — the worker's npm package writes it, the backend's musl vec0.so reads
// it — so a divergence is a reader and a writer disagreeing about the on-disk
// shape of the index, with nothing to notice it (#261).
describe("the pins in this repository", () => {
	test("are one sqlite-vec version", () => {
		const divergence = findVersionDivergence({
			dockerfileVersion: readDockerfileVersion(read("Dockerfile")),
			workerPin: readWorkerVersion(
				read("docker/runtime/search-index-worker/package.json"),
			),
			workerLockVersion: readWorkerLockVersion(
				read("docker/runtime/search-index-worker/package-lock.json"),
			),
		});
		assert.equal(divergence, null, divergence ?? "");
	});
});
