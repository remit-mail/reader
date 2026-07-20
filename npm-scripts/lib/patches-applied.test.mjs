import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findUnappliedPatches, parsePatch } from "./patches-applied.mjs";

// The shape of the real emitter patches: a published line replaced by one that
// escapes the value properly. Both sides are declared once and the fixtures are
// built from them, so the test cannot drift from what it claims to compare.
const PUBLISHED_LINES = [
	'        const valueStr = typeof value === "string" ? `"${value}"` : value;',
	'        return `\\t"${key}": ${valueStr}`;',
];

const PATCHED_LINES = [
	'        const valueStr = typeof value === "string" ? JSON.stringify(value) : value;',
	"        return `\\t${JSON.stringify(key)}: ${valueStr}`;",
];

const TARGET = "node_modules/pkg/dist/emitter.js";

const PATCH = [
	`diff --git a/${TARGET} b/${TARGET}`,
	`--- a/${TARGET}`,
	`+++ b/${TARGET}`,
	"@@ -52,8 +52,8 @@ function generateEnumObject(members) {",
	"         const value = member.value ?? member.name;",
	...PUBLISHED_LINES.map((line) => `-${line}`),
	...PATCHED_LINES.map((line) => `+${line}`),
	"     })",
].join("\n");

const patches = [{ name: "pkg.patch", diff: PATCH }];

const asFile = (lines) => `${lines.join("\n")}\n`;

describe("parsePatch", () => {
	test("collects the added lines per target file, without the diff markers", () => {
		const added = parsePatch(PATCH).get(TARGET);

		assert.deepEqual(added, PATCHED_LINES);
	});

	test("the +++ header is not mistaken for an added line", () => {
		const added = parsePatch(PATCH).get(TARGET);

		assert.ok(added.every((line) => !line.includes(TARGET)));
	});
});

describe("findUnappliedPatches", () => {
	test("a patched tree reports nothing", async () => {
		const findings = await findUnappliedPatches(patches, async () =>
			asFile(PATCHED_LINES),
		);

		assert.deepEqual(findings, []);
	});

	// The regression this guard exists for: the install ran and the package is
	// there, it is simply the version npm published. patch-package never saw the
	// patch directory, so nothing failed, and the escapes stayed eaten all the
	// way into the published images (#79).
	test("an installed but unpatched package is reported", async () => {
		const findings = await findUnappliedPatches(patches, async () =>
			asFile(PUBLISHED_LINES),
		);

		assert.equal(findings.length, 1);
		assert.match(findings[0], /missing the patched content/);
	});

	test("a patch whose target was never installed is reported", async () => {
		const findings = await findUnappliedPatches(patches, async () => null);

		assert.equal(findings.length, 1);
		assert.match(findings[0], /not installed/);
	});
});
