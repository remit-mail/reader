import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "manifest-check.sh");

function classify(status, output) {
	return execFileSync(
		"bash",
		["-c", 'source "$1"; classify_manifest_check "$2" "$3"', "classify", LIB, String(status), output],
		{ encoding: "utf8" },
	).trim();
}

describe("classify_manifest_check", () => {
	it("reads exit 0 as exists", () => {
		assert.equal(classify(0, ""), "exists");
	});

	it("reads docker's manifest unknown as absent", () => {
		assert.equal(classify(1, "manifest unknown"), "absent");
	});

	// The exact wording verified live against GHCR through podman: it wraps the
	// same "manifest unknown" the registry sent inside its own error text.
	it("reads podman's manifest unknown as absent, wrapped in its own error text", () => {
		const output =
			'Error: reading image "docker://ghcr.io/remit-mail/reader/backend:v9.9.9": ' +
			"reading manifest v9.9.9 in ghcr.io/remit-mail/reader/backend: manifest unknown";
		assert.equal(classify(1, output), "absent");
	});

	// The regression this guards: any failure other than "manifest unknown" must
	// never be read as "the tag is free" — that misreading is what let a
	// degraded registry or a typo'd REGISTRY through in an earlier version of
	// this script.
	it("reads a DNS failure as abort, never as free", () => {
		const output =
			'failed to configure transport: error pinging v2 registry: Get "https://bad.invalid/v2/": ' +
			"dial tcp: lookup bad.invalid: no such host";
		assert.equal(classify(1, output), "abort");
	});

	it("reads denied for a never-published package as abort", () => {
		const output = 'Get "https://ghcr.io/v2/remit-mail/reader/new-service/manifests/v1.0.0": denied';
		assert.equal(classify(1, output), "abort");
	});

	it("reads an unauthorized response as abort", () => {
		assert.equal(classify(1, "unauthorized: authentication required"), "abort");
	});

	it("does not match manifest unknown as a substring of a longer, unrelated failure", () => {
		assert.equal(classify(1, "connection reset by peer"), "abort");
	});
});
