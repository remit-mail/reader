/**
 * The fragment across the mail↔calendar switch.
 *
 * The calendar is a sibling of mail in the shell, not a different app, so the
 * chrome a reader has up travels with them: the rail is a pane they keep, the
 * slide-over and the sheet are overlays that going somewhere dismisses. The
 * calendar owns no panel of its own — nothing calendar-specific joins the union
 * (R3) — so the only thing it does to the fragment is carry it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatOpenPanels,
	panelFragments,
	panelsWithOverlay,
	parseOpenPanels,
	retainOpenPanelsAtTier,
} from "./fragment.js";

const retainOnDesktop = retainOpenPanelsAtTier(true);
const retainOnPhone = retainOpenPanelsAtTier(false);

describe("the calendar names no panel of its own", () => {
	it("leaves the union exactly as mail wrote it", () => {
		assert.deepEqual(panelFragments, ["intelligence", "nav", "shortcuts"]);
	});
});

describe("crossing between mail and the calendar", () => {
	// The nav entry is a `NavLink`, so both directions go through the same
	// retention the mail lists already navigate under.
	it("carries the rail into the calendar and back out again", () => {
		assert.equal(retainOnDesktop("intelligence"), "intelligence");
	});

	it("leaves the slide-over the reader picked the entry from behind", () => {
		assert.equal(retainOnDesktop("nav"), "");
		assert.equal(retainOnDesktop("intelligence,nav"), "intelligence");
	});

	it("leaves the drawer behind on a tier that has no rail", () => {
		assert.equal(retainOnPhone("intelligence"), "");
		assert.equal(retainOnPhone("intelligence,nav"), "");
	});
});

describe("reaching for the folders while on the calendar", () => {
	const opened = (hash: string): string =>
		formatOpenPanels(panelsWithOverlay(parseOpenPanels(hash), "nav"));
	const closed = (hash: string): string =>
		formatOpenPanels(panelsWithOverlay(parseOpenPanels(hash), undefined));

	it("keeps the rail the reader arrived with", () => {
		assert.equal(opened("intelligence"), "intelligence,nav");
		assert.equal(closed("intelligence,nav"), "intelligence");
	});

	it("puts the slide-over up over nothing else, and takes it down again", () => {
		assert.equal(opened(""), "nav");
		assert.equal(closed("nav"), "");
	});

	it("replaces whichever overlay was up, because two cannot be", () => {
		assert.equal(opened("intelligence,shortcuts"), "intelligence,nav");
	});
});
