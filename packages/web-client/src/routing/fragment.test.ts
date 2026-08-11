import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	panelFragments,
	parsePanelFragment,
	retainOpenPanel,
} from "./fragment.js";

describe("parsePanelFragment", () => {
	it("reads every panel the union names", () => {
		for (const panel of panelFragments) {
			assert.equal(parsePanelFragment(panel), panel);
		}
	});

	it("reads an empty, unknown or mis-cased fragment as no panel", () => {
		assert.equal(parsePanelFragment(""), undefined);
		assert.equal(parsePanelFragment("confirm-delete"), undefined);
		assert.equal(parsePanelFragment("Intelligence"), undefined);
		assert.equal(parsePanelFragment("form:input:to"), undefined);
	});
});

describe("retainOpenPanel", () => {
	it("carries the rail across a navigation", () => {
		assert.equal(retainOpenPanel("intelligence"), "intelligence");
	});

	it("drops the panels that going somewhere dismisses", () => {
		assert.equal(retainOpenPanel("nav"), "");
		assert.equal(retainOpenPanel("shortcuts"), "");
	});

	it("drops a fragment it does not recognise rather than passing it on", () => {
		assert.equal(retainOpenPanel(""), "");
		assert.equal(retainOpenPanel("confirm-delete"), "");
	});
});
