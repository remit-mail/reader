import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatOpenPanels,
	panelFragments,
	parseOpenPanels,
	retainOpenPanels,
} from "./fragment.js";

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

describe("retainOpenPanels", () => {
	it("carries a pane across a navigation", () => {
		assert.equal(retainOpenPanels("intelligence"), "intelligence");
	});

	it("leaves the overlays behind, and keeps the pane under them", () => {
		assert.equal(retainOpenPanels("nav"), "");
		assert.equal(retainOpenPanels("shortcuts"), "");
		assert.equal(retainOpenPanels("intelligence,shortcuts"), "intelligence");
	});

	it("drops a fragment it does not recognise rather than passing it on", () => {
		assert.equal(retainOpenPanels(), "");
		assert.equal(retainOpenPanels("confirm-delete"), "");
	});
});
