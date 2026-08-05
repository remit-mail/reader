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

	it("treats every below-desktop width as single-pane via resolveLayoutTier", () => {
		assert.equal(isSinglePaneTier(resolveLayoutTier(mouse(390))), true);
		assert.equal(isSinglePaneTier(resolveLayoutTier(mouse(768))), true);
		assert.equal(isSinglePaneTier(resolveLayoutTier(mouse(1023))), true);
		assert.equal(isSinglePaneTier(resolveLayoutTier(mouse(1024))), false);
		assert.equal(
			isSinglePaneTier(resolveLayoutTier(tabletHeldUpright(1024))),
			true,
		);
	});
});

describe("exactly one search field is mounted at every width", () => {
	// Two call sites decide this from the same tier: `mail.tsx` mounts the top
	// bar's field when the layout is not single-pane, and `MailListHeader`
	// passes `showSearch` to keep the header's field otherwise. Both read
	// `isSinglePaneTier`, so they are each other's complement by construction —
	// if either is rewritten to its own expression this fails. Two mounted
	// fields compete for "/" and for focus (#59); zero leaves no way to search.
	const mountsTopBarField = (viewport: ViewportProfile): boolean =>
		!isSinglePaneTier(resolveLayoutTier(viewport));
	const mountsHeaderField = (viewport: ViewportProfile): boolean =>
		isSinglePaneTier(resolveLayoutTier(viewport));

	for (const viewport of [
		mouse(0),
		mouse(390),
		mouse(767),
		mouse(768),
		mouse(1023),
		mouse(1024),
		mouse(1440),
		tabletHeldUpright(1024),
	]) {
		it(`mounts one field at ${viewport.width}px ${viewport.orientation}/${viewport.pointer}`, () => {
			const fields =
				Number(mountsTopBarField(viewport)) +
				Number(mountsHeaderField(viewport));
			assert.equal(fields, 1, `${viewport.width}px mounts ${fields} fields`);
		});
	}

	it("puts the field in the top bar only from desktop up", () => {
		assert.equal(mountsTopBarField(mouse(1023)), false);
		assert.equal(mountsTopBarField(mouse(1024)), true);
		assert.equal(mountsTopBarField(tabletHeldUpright(1024)), false);
	});
});
