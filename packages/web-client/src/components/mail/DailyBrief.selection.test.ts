import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The brief raises one selection surface at every width, and select-all is on
 * it — wired into the touch sheet alone, the same list could be selected whole
 * on a phone and not on a desktop (#453).
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
	it("reaches the one selection bar from one derivation", () => {
		const body = chromeBody();
		const derivations = body.match(/const selectAll = useMemo\(/g) ?? [];
		assert.equal(derivations.length, 1, "one select-all");
		const bars = body.match(/<SelectionTopBar\b/g) ?? [];
		assert.equal(bars.length, 1, "one surface, at every width (#480)");
		const wired = body.match(/selectAll=\{selectAll\}/g) ?? [];
		assert.equal(wired.length, 1, "the bar takes it");
	});

	it("is offered only when there are rows to select", () => {
		assert.match(chromeBody(), /orderedIds\.length > 0/);
	});

	it("mounts the bar unconditionally — it is the list header (#480)", () => {
		assert.match(
			chromeBody(),
			/const selectionBar = \(chrome: ListHeaderChrome\) => \(\s*<SelectionTopBar/,
		);
	});

	it("carries every verb the bar can offer (#477 1.4)", () => {
		// That each of them opens the wizard is `selection-verbs.test.ts`, over
		// every surface at once. What this pins is that none of them was dropped
		// from the bar the brief raises.
		const body = chromeBody();
		for (const prop of [
			"onDelete",
			"onMove",
			"onOrganize",
			"onJunk",
			"onMarkRead",
		]) {
			assert.match(body, new RegExp(`${prop}=`));
		}
		assert.doesNotMatch(body, /onSomethingElse/);
	});

	it("drives the wizard and the keyboard layer from one control", () => {
		// Two copies of "which verb is the wizard on" is how the brief came to
		// offer a verb the mailbox list did not, and how its keyboard came to act
		// behind a wizard the bar had opened.
		assert.match(source, /const wizard = useSelectionWizard\(\);/);
		assert.match(source, /onSelectionVerb={wizard.start}/);
		assert.match(source, /wizardOpen={wizard.isOpen}/);
	});
});
