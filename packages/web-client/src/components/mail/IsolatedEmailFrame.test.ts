/**
 * Unit coverage for `IsolatedEmailFrame`'s content-sizing math and the
 * margin-reset injection (#528).
 *
 * The component sizes a sandboxed iframe to its content on both axes so the
 * frame grows no internal scrollbars: vertical scrolling and (for wide
 * fixed-width newsletters) horizontal scrolling are delegated to the parent
 * pane viewport, where the scrollbar is always visible. The actual DOM
 * measurement runs in a real browser (jsdom doesn't lay out iframes), so the
 * pure axis math is extracted into `measureContentAxis` and pinned here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { measureContentAxis } from "./IsolatedEmailFrame";

describe("measureContentAxis (#528 content-sizing)", () => {
	it("takes the larger of body and documentElement scroll size", () => {
		assert.equal(measureContentAxis(600, 900, 10_000), 900);
		assert.equal(measureContentAxis(900, 600, 10_000), 900);
	});

	it("rounds UP so a fractional content size never leaves a 1px phantom overflow", () => {
		assert.equal(measureContentAxis(600.1, 0, 10_000), 601);
		assert.equal(measureContentAxis(0, 899.4, 10_000), 900);
	});

	it("caps at the supplied max so a hostile sender can't allocate unbounded layout", () => {
		assert.equal(measureContentAxis(50_001, 0, 50_000), 50_000);
		assert.equal(measureContentAxis(0, 25_000, 10_000), 10_000);
	});

	it("returns an exact integer for already-integral content (no spurious +1)", () => {
		assert.equal(measureContentAxis(672, 0, 10_000), 672);
		assert.equal(measureContentAxis(0, 0, 10_000), 0);
	});
});
