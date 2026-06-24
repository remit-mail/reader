import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type PaneLayout, resolvePaneLayout } from "./app-shell-types.js";

/**
 * The single responsive surface reflows by its own width. These cases pin the
 * pane-count-by-width rule the AppShell render obeys (both read the same
 * READING_PANE_MIN_WIDTH / INTELLIGENCE_MIN_WIDTH constants):
 *   phone + tablet PORTRAIT (<1024) → list ALONE, no reading pane
 *   tablet landscape / desktop (1024–1279) → list + reading
 *   widest (≥1280) → + intelligence rail
 */
const paneCount = (l: PaneLayout) =>
	Number(l.nav) + 1 + Number(l.reading) + Number(l.intelligence);

describe("resolvePaneLayout — pane count by width", () => {
	it("phone (390): list alone, one pane", () => {
		const l = resolvePaneLayout(390);
		assert.equal(l.reading, false, "no reading pane on phone");
		assert.equal(l.intelligence, false);
		assert.equal(paneCount(l), 1, "single pane");
	});

	it("tablet portrait (768): list alone, no reading pane", () => {
		const l = resolvePaneLayout(768);
		assert.equal(l.reading, false, "portrait tablet collapses to the list");
		assert.equal(paneCount(l), 1);
	});

	it("tablet portrait (834, iPad): still list alone", () => {
		const l = resolvePaneLayout(834);
		assert.equal(l.reading, false);
		assert.equal(paneCount(l), 1);
	});

	it("just below the reading boundary (1023): still list alone", () => {
		assert.equal(resolvePaneLayout(1023).reading, false);
	});

	it("tablet landscape / desktop floor (1024): list + reading + nav", () => {
		const l = resolvePaneLayout(1024);
		assert.equal(l.reading, true, "reading pane appears at 1024");
		assert.equal(l.nav, true, "nav becomes a persistent pane");
		assert.equal(l.intelligence, false, "rail not yet — only at the widest");
		assert.equal(paneCount(l), 3);
	});

	it("iPad landscape (1112): two content panes, no rail", () => {
		const l = resolvePaneLayout(1112);
		assert.equal(l.reading, true);
		assert.equal(l.intelligence, false);
	});

	it("just below the rail boundary (1279): no rail", () => {
		assert.equal(resolvePaneLayout(1279).intelligence, false);
	});

	it("widest (1280): + intelligence rail, four panes", () => {
		const l = resolvePaneLayout(1280);
		assert.equal(l.reading, true);
		assert.equal(l.intelligence, true);
		assert.equal(paneCount(l), 4);
	});

	it("monotonic: panes only ever appear as width grows", () => {
		const widths = [320, 768, 834, 1024, 1112, 1280, 1920];
		const counts = widths.map((w) => paneCount(resolvePaneLayout(w)));
		const sorted = [...counts].sort((a, b) => a - b);
		assert.deepEqual(counts, sorted, "pane count is non-decreasing in width");
	});
});

describe("resolvePaneLayout — configurable thresholds (#900/#901)", () => {
	it("respects a custom reading-pane boundary", () => {
		assert.equal(
			resolvePaneLayout(767, 768, 1280).reading,
			false,
			"just below custom reading boundary",
		);
		assert.equal(
			resolvePaneLayout(768, 768, 1280).reading,
			true,
			"at the custom reading boundary",
		);
	});

	it("respects a custom intelligence boundary", () => {
		assert.equal(
			resolvePaneLayout(1023, 1024, 1024).intelligence,
			false,
			"just below custom intelligence boundary",
		);
		assert.equal(
			resolvePaneLayout(1024, 1024, 1024).intelligence,
			true,
			"at the custom intelligence boundary",
		);
	});

	it("defaults still match the module constants when no overrides given", () => {
		const withDefaults = resolvePaneLayout(1024);
		const withExplicit = resolvePaneLayout(1024, 1024, 1280);
		assert.deepEqual(withDefaults, withExplicit, "defaults are identical");
	});
});
