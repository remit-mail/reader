import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSinglePaneTier, resolveLayoutTier } from "./useLayoutTier";

describe("resolveLayoutTier breakpoints (#784)", () => {
	it("is phone below 768", () => {
		assert.equal(resolveLayoutTier(767), "phone");
		assert.equal(resolveLayoutTier(390), "phone");
		assert.equal(resolveLayoutTier(0), "phone");
	});

	it("is tablet from 768 up to 1023", () => {
		assert.equal(resolveLayoutTier(768), "tablet");
		assert.equal(resolveLayoutTier(900), "tablet");
		assert.equal(resolveLayoutTier(1023), "tablet");
	});

	it("is desktop from 1024 up", () => {
		assert.equal(resolveLayoutTier(1024), "desktop");
		assert.equal(resolveLayoutTier(1440), "desktop");
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
		assert.equal(isSinglePaneTier(resolveLayoutTier(390)), true);
		assert.equal(isSinglePaneTier(resolveLayoutTier(768)), true);
		assert.equal(isSinglePaneTier(resolveLayoutTier(1023)), true);
		assert.equal(isSinglePaneTier(resolveLayoutTier(1024)), false);
	});
});

describe("exactly one search field is mounted at every width", () => {
	// Two call sites decide this from the same tier: `mail.tsx` mounts the top
	// bar's field when the layout is not single-pane, and `MailListHeader`
	// passes `showSearch` to keep the header's field otherwise. Both read
	// `isSinglePaneTier`, so they are each other's complement by construction —
	// if either is rewritten to its own expression this fails. Two mounted
	// fields compete for "/" and for focus (#59); zero leaves no way to search.
	const mountsTopBarField = (width: number): boolean =>
		!isSinglePaneTier(resolveLayoutTier(width));
	const mountsHeaderField = (width: number): boolean =>
		isSinglePaneTier(resolveLayoutTier(width));

	for (const width of [0, 390, 767, 768, 1023, 1024, 1440]) {
		it(`mounts one field at ${width}px`, () => {
			const fields =
				Number(mountsTopBarField(width)) + Number(mountsHeaderField(width));
			assert.equal(fields, 1, `${width}px mounts ${fields} search fields`);
		});
	}

	it("puts the field in the top bar only from desktop up", () => {
		assert.equal(mountsTopBarField(1023), false);
		assert.equal(mountsTopBarField(1024), true);
	});
});
