import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isSinglePaneTier,
	resolveLayoutTier,
	type ViewportProfile,
} from "./useLayoutTier";

const mouse = (width: number): ViewportProfile => ({
	width,
	orientation: "landscape",
	pointer: "fine",
});

const tabletHeldUpright = (width: number): ViewportProfile => ({
	width,
	orientation: "portrait",
	pointer: "coarse",
});

describe("resolveLayoutTier breakpoints (#784)", () => {
	it("is phone below 768", () => {
		assert.equal(resolveLayoutTier(mouse(767)), "phone");
		assert.equal(resolveLayoutTier(mouse(390)), "phone");
		assert.equal(resolveLayoutTier(mouse(0)), "phone");
	});

	it("is tablet from 768 up to 1023", () => {
		assert.equal(resolveLayoutTier(mouse(768)), "tablet");
		assert.equal(resolveLayoutTier(mouse(900)), "tablet");
		assert.equal(resolveLayoutTier(mouse(1023)), "tablet");
	});

	it("is desktop from 1024 up", () => {
		assert.equal(resolveLayoutTier(mouse(1024)), "desktop");
		assert.equal(resolveLayoutTier(mouse(1440)), "desktop");
	});
});

describe("a touch screen held upright is never desktop", () => {
	// Regression: a large tablet is exactly 1024px wide in portrait, so a width
	// threshold alone handed it the four-pane desktop shell. Turned sideways
	// the same device is a desktop surface, and a tall monitor always is.
	it("is tablet at 1024px in portrait on a touch screen", () => {
		assert.equal(resolveLayoutTier(tabletHeldUpright(1024)), "tablet");
	});

	it("is tablet at wider portrait touch widths too", () => {
		assert.equal(resolveLayoutTier(tabletHeldUpright(1366)), "tablet");
	});

	it("is desktop at 1024px on the same device turned sideways", () => {
		assert.equal(
			resolveLayoutTier({
				width: 1024,
				orientation: "landscape",
				pointer: "coarse",
			}),
			"desktop",
		);
	});

	it("is desktop on a portrait monitor, which has a fine pointer", () => {
		assert.equal(
			resolveLayoutTier({
				width: 1200,
				orientation: "portrait",
				pointer: "fine",
			}),
			"desktop",
		);
	});

	it("keeps the phone/tablet split on width alone", () => {
		assert.equal(resolveLayoutTier(tabletHeldUpright(767)), "phone");
		assert.equal(resolveLayoutTier(tabletHeldUpright(768)), "tablet");
	});
});

describe("isSinglePaneTier — compose surface must mount below desktop", () => {
	// Regression: AppShellSlotted mounts the reading pane only at desktop, and
	// the compose surface lives in the single pane below it. Tablet (768–1023)
	// must be single-pane so "c" / the FAB can open compose — keying the pane
	// choice off "phone" alone left tablet with no compose surface.
	it("is single-pane at phone", () => {
		assert.equal(isSinglePaneTier("phone"), true);
	});

	it("is single-pane at tablet (the regression tier)", () => {
		assert.equal(isSinglePaneTier("tablet"), true);
	});

	it("is NOT single-pane at desktop (reading pane hosts compose)", () => {
		assert.equal(isSinglePaneTier("desktop"), false);
	});
});
