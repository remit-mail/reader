import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const LIB = join(
	dirname(fileURLToPath(import.meta.url)),
	"tag-object-check.sh",
);

function classify(status, objectType) {
	return execFileSync(
		"bash",
		[
			"-c",
			'source "$1"; classify_tag_object "$2" "$3"',
			"classify",
			LIB,
			String(status),
			objectType,
		],
		{ encoding: "utf8" },
	).trim();
}

describe("classify_tag_object", () => {
	// `git cat-file -t` prints the type with a trailing newline.
	it("reads a tag object as annotated", () => {
		assert.equal(classify(0, "tag\n"), "annotated");
	});

	it("reads a commit object as lightweight", () => {
		assert.equal(classify(0, "commit\n"), "lightweight");
	});

	// The regression this guards: a failed lookup must never read as annotated.
	// If the tag object was never fetched, cat-file fails, and treating that as
	// "fine" would publish a release with no authored summary.
	it("reads a failed lookup as abort, never as annotated", () => {
		assert.equal(
			classify(128, "fatal: Not a valid object name refs/tags/v1.0.0"),
			"abort",
		);
	});

	it("reads an empty answer as abort", () => {
		assert.equal(classify(0, ""), "abort");
	});

	// A tag ref may legally point at a tree or a blob. Neither carries an
	// annotation, and neither is a release.
	it("reads a tree as abort", () => {
		assert.equal(classify(0, "tree\n"), "abort");
	});

	it("reads a blob as abort", () => {
		assert.equal(classify(0, "blob\n"), "abort");
	});

	it("reads an unrecognised type as abort", () => {
		assert.equal(classify(0, "whatever"), "abort");
	});
});
