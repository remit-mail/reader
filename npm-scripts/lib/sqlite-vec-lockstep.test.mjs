import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	findVersionDivergence,
	readDockerfilePinSource,
	readWorkerLockVersion,
	readWorkerVersion,
} from "./sqlite-vec-lockstep.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(join(repoRoot, ...parts), "utf8");

// The shape of the sqlite-vec-musl stage as it ships: a manifest copied in,
// the pin read out of it, no version ARG of its own.
const STAGE = [
	"FROM docker.io/library/alpine:3.23 AS sqlite-vec-musl",
	"ARG SQLITE_VEC_SHA256=3acd67cb",
	"COPY docker/runtime/search-index-worker/package.json /worker-package.json",
	'RUN SQLITE_VEC_VERSION="$(jq -r \'.dependencies["sqlite-vec"]\' /worker-package.json)" \\',
	'\t&& curl -fsSL -o amalgamation.tar.gz "https://example.invalid/v${SQLITE_VEC_VERSION}.tar.gz"',
	"",
].join("\n");

describe("reading the one pin", () => {
	test("takes the musl build's version source from the manifest it copies", () => {
		assert.equal(
			readDockerfilePinSource(STAGE),
			"docker/runtime/search-index-worker/package.json",
		);
	});

	test("refuses a stage that declares its own version ARG", () => {
		assert.throws(
			() =>
				readDockerfilePinSource(
					[
						"FROM alpine AS sqlite-vec-musl",
						"ARG SQLITE_VEC_VERSION=0.1.9",
						"",
					].join("\n"),
				),
			/ARG SQLITE_VEC_VERSION/,
		);
	});

	test("refuses a stage that copies no manifest", () => {
		assert.throws(
			() =>
				readDockerfilePinSource(
					"FROM alpine AS sqlite-vec-musl\nRUN apk add sqlite\n",
				),
			/copies no package\.json/,
		);
	});

	test("refuses a stage that never reads the pin out of the manifest", () => {
		assert.throws(
			() =>
				readDockerfilePinSource(
					STAGE.replace(
						"jq -r '.dependencies[\"sqlite-vec\"]'",
						"jq -r '.name'",
					),
				),
			/never reads/,
		);
	});

	test("refuses a Dockerfile that has no sqlite-vec-musl stage", () => {
		assert.throws(
			() => readDockerfilePinSource("FROM alpine\nRUN apk add sqlite\n"),
			/no sqlite-vec-musl stage/,
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
	test("passes an exact pin the lockfile resolves", () => {
		assert.equal(
			findVersionDivergence({
				workerPin: "0.1.9",
				workerLockVersion: "0.1.9",
			}),
			null,
		);
	});

	// `npm ci` installs the lockfile, so a lockfile that moved on its own is
	// the version the worker image runs while the musl stage compiles the
	// manifest's pin — a reader and a writer quietly apart.
	test("names the lockfile when it resolves a different version", () => {
		assert.match(
			findVersionDivergence({
				workerPin: "0.1.9",
				workerLockVersion: "0.1.10",
			}),
			/lockfile resolves 0\.1\.10/,
		);
	});

	// A range is a divergence that has not happened yet: the musl stage's
	// sha256 covers exactly one tarball, and its build guard rejects anything
	// but an exact pin — loudly, but only once someone builds the image.
	test("refuses a range even when the lockfile currently resolves to it", () => {
		for (const workerPin of ["^0.1.9", "~0.1.9"]) {
			assert.match(
				findVersionDivergence({ workerPin, workerLockVersion: "0.1.9" }),
				/Pin it exactly/,
			);
		}
	});
});

// The check itself, against the files that ship. The two builds share one
// vec.db — the worker's npm package writes it, the backend's musl vec0.so
// reads it — and one manifest feeds both, so what is left to verify is that
// the musl stage really copies that manifest (#261) and that the manifest's
// pin is exact and lockfile-resolved.
describe("the pins in this repository", () => {
	test("the musl build compiles the version the worker installs", () => {
		const manifestPath = readDockerfilePinSource(read("Dockerfile"));
		// The stage has to copy the manifest the worker image `npm ci`s; a
		// different manifest would be a second pin wearing the same shape.
		assert.equal(
			manifestPath,
			"docker/runtime/search-index-worker/package.json",
		);
		const divergence = findVersionDivergence({
			workerPin: readWorkerVersion(read(manifestPath)),
			workerLockVersion: readWorkerLockVersion(
				read("docker/runtime/search-index-worker/package-lock.json"),
			),
		});
		assert.equal(divergence, null, divergence ?? "");
	});
});
