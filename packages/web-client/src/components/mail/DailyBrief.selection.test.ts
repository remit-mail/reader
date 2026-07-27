import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The brief raises two selection surfaces — the desktop toolbar and the touch
 * sheet — and they offer the same verbs. Select-all was wired into the sheet
 * only, so the same list could be selected whole on a phone and not on a
 * desktop (#453).
 *
 * As with `MessageList.selection.test.ts`, `DailyBrief` weaves routing, the
 * cursor and several data hooks together, so the rule is enforced by reading
 * the source. `resolveBriefSelectionScope` carries the decisions that can be
 * unit-tested on their own.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "DailyBrief.tsx"), "utf8");

const chromeBody = (): string => {
	const start = source.indexOf("function BriefSelectionChrome(");
	assert.notEqual(start, -1, "BriefSelectionChrome is defined");
	const next = source.indexOf("\nfunction ", start + 1);
	return source.slice(start, next === -1 ? undefined : next);
};

describe("the brief's select-all", () => {
	it("reaches the desktop toolbar and the touch sheet from one derivation", () => {
		const body = chromeBody();
		const derivations = body.match(/const selectAll = useMemo\(/g) ?? [];
		assert.equal(
			derivations.length,
			1,
			"one select-all, so the two surfaces cannot drift",
		);
		const wired = body.match(/selectAll=\{selectAll\}/g) ?? [];
		assert.equal(
			wired.length,
			2,
			"both SelectionToolbar and SelectionSheet take it",
		);
	});

	it("is offered only when there are rows to select", () => {
		assert.match(chromeBody(), /orderedIds\.length > 0/);
	});
});
