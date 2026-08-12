import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatOpenPanels,
	panelFragments,
	parseOpenPanels,
	retainOpenPanelsAtTier,
} from "./fragment.js";

const retainOnDesktop = retainOpenPanelsAtTier(true);
const retainOnPhone = retainOpenPanelsAtTier(false);

describe("parseOpenPanels", () => {
	it("reads every panel the union names", () => {
		for (const panel of panelFragments) {
			assert.deepEqual(parseOpenPanels(panel), [panel]);
		}
	});

	it("reads a pane and an overlay together", () => {
		assert.deepEqual(parseOpenPanels("intelligence,shortcuts"), [
			"intelligence",
			"shortcuts",
		]);
	});

	it("spells one set of panels one way", () => {
		assert.deepEqual(parseOpenPanels("shortcuts,intelligence,shortcuts"), [
			"intelligence",
			"shortcuts",
		]);
	});

	it("reads an empty, unknown or mis-cased fragment as no panel", () => {
		assert.deepEqual(parseOpenPanels(""), []);
		assert.deepEqual(parseOpenPanels("confirm-delete"), []);
		assert.deepEqual(parseOpenPanels("Intelligence"), []);
		assert.deepEqual(parseOpenPanels("form:input:to"), []);
	});

	it("keeps the panels it recognises out of a fragment carrying junk", () => {
		assert.deepEqual(parseOpenPanels("filters,intelligence"), ["intelligence"]);
	});
});

describe("formatOpenPanels", () => {
	it("writes the address a set of panels is read back from", () => {
		assert.equal(
			formatOpenPanels(["shortcuts", "intelligence"]),
			"intelligence,shortcuts",
		);
		assert.equal(formatOpenPanels([]), "");
	});
});

describe("retainOpenPanelsAtTier", () => {
	it("carries a pane across a navigation on the tier that has one", () => {
		assert.equal(retainOnDesktop("intelligence"), "intelligence");
	});

	it("leaves the overlays behind, and keeps the pane under them", () => {
		assert.equal(retainOnDesktop("nav"), "");
		assert.equal(retainOnDesktop("shortcuts"), "");
		assert.equal(retainOnDesktop("intelligence,shortcuts"), "intelligence");
	});

	it("drops a fragment it does not recognise rather than passing it on", () => {
		assert.equal(retainOnDesktop(), "");
		assert.equal(retainOnDesktop("confirm-delete"), "");
		assert.equal(retainOnPhone("confirm-delete"), "");
	});
});

/**
 * Below desktop the rail is a full-screen drawer over the open message, so it
 * belongs to the thread it was opened for. Every navigation that handed the
 * fragment on put the drawer over the next message the reader opened.
 *
 * Each case walks the fragment through the navigations of one reachable path,
 * starting from the address the open drawer wrote.
 */
describe("the drawer stays with its thread below desktop (#777)", () => {
	const walk = (
		retain: (hash?: string) => string,
		hash: string,
		steps: number,
	): string => {
		let current = hash;
		for (let step = 0; step < steps; step += 1) current = retain(current);
		return current;
	};

	// A DKIM mismatch opens the drawer; the reader taps the back arrow instead
	// of closing it, then taps another row.
	it("drops the rail between the back arrow and the next row", () => {
		assert.equal(walk(retainOnPhone, "intelligence", 2), "");
		assert.equal(walk(retainOnDesktop, "intelligence", 2), "intelligence");
	});

	// "Report spam" inside the open drawer removes the thread the drawer is
	// reading, which closes it up to the list — one navigation, no back button.
	it("drops the rail when a quick action in the drawer removes the thread", () => {
		assert.equal(retainOnPhone("intelligence"), "");
		assert.equal(retainOnDesktop("intelligence"), "intelligence");
	});

	// The brief and the flagged list open a thread from a cross-mailbox row,
	// and the shortcuts sheet may be up over the drawer when they do.
	it("drops the rail when the brief or the flagged list opens a thread", () => {
		assert.equal(retainOnPhone("intelligence,shortcuts"), "");
		assert.equal(retainOnDesktop("intelligence,shortcuts"), "intelligence");
	});
});
