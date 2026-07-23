import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSheetSnap } from "./selection-sheet.js";

const base = {
	expandedHeight: 320,
	teaserHeight: 56,
	flickVelocity: 0.5,
};

describe("resolveSheetSnap", () => {
	it("flicks up expand regardless of how far the drag travelled", () => {
		assert.equal(
			resolveSheetSnap({ ...base, expanded: false, delta: -4, velocity: -1.2 }),
			true,
		);
	});

	it("flicks down collapse regardless of how far the drag travelled", () => {
		assert.equal(
			resolveSheetSnap({ ...base, expanded: true, delta: 4, velocity: 1.2 }),
			false,
		);
	});

	it("a slow upward drag past the midpoint expands from the teaser", () => {
		// midpoint = (320 - 56) / 2 = 132; -140 crosses it going up.
		assert.equal(
			resolveSheetSnap({
				...base,
				expanded: false,
				delta: -140,
				velocity: 0.1,
			}),
			true,
		);
	});

	it("a slow upward drag short of the midpoint settles back to the teaser", () => {
		assert.equal(
			resolveSheetSnap({
				...base,
				expanded: false,
				delta: -100,
				velocity: 0.1,
			}),
			false,
		);
	});

	it("a slow downward drag past the midpoint collapses from expanded", () => {
		assert.equal(
			resolveSheetSnap({ ...base, expanded: true, delta: 140, velocity: 0.1 }),
			false,
		);
	});

	it("a slow downward drag short of the midpoint stays expanded", () => {
		assert.equal(
			resolveSheetSnap({ ...base, expanded: true, delta: 100, velocity: 0.1 }),
			true,
		);
	});

	it("a barely-moved release keeps the current snap state", () => {
		assert.equal(
			resolveSheetSnap({ ...base, expanded: true, delta: 0, velocity: 0 }),
			true,
		);
		assert.equal(
			resolveSheetSnap({ ...base, expanded: false, delta: 0, velocity: 0 }),
			false,
		);
	});

	it("defaults the flick threshold when omitted", () => {
		assert.equal(
			resolveSheetSnap({
				expanded: false,
				delta: -4,
				velocity: -1,
				expandedHeight: 320,
				teaserHeight: 56,
			}),
			true,
		);
	});
});
