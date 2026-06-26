import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildEmailSrcDoc,
	DARK_OPT_IN_RE,
	generateFramedEmailBaseCSS,
	generatePlainEmailBaseCSS,
	VIEWPORT_META,
} from "./email-frame-css.js";
import { measureContentAxis } from "./isolated-email-frame.js";

describe("measureContentAxis (content-sizing)", () => {
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

describe("generatePlainEmailBaseCSS (theme tokens pinned)", () => {
	it("injects the light-theme resolved tokens", () => {
		const css = generatePlainEmailBaseCSS(false);
		assert.match(css, /oklch\(0\.3 0\.025 235\)/);
		assert.match(css, /oklch\(0\.975 0\.012 90\)/);
		assert.match(css, /oklch\(0\.55 0\.14 150\)/);
	});

	it("injects the dark-theme resolved tokens", () => {
		const css = generatePlainEmailBaseCSS(true);
		assert.match(css, /oklch\(0\.88 0\.02 90\)/);
		assert.match(css, /oklch\(0\.25 0\.025 220\)/);
		assert.match(css, /oklch\(0\.78 0\.16 150\)/);
	});

	it("strips author colors and backgrounds from body descendants only", () => {
		const css = generatePlainEmailBaseCSS(false);
		assert.match(css, /body \*\s*\{[^}]*color:\s*inherit\s*!important/);
		assert.match(
			css,
			/body \*\s*\{[^}]*background-color:\s*transparent\s*!important/,
		);
	});
});

describe("generateFramedEmailBaseCSS (K-9 dark strategy)", () => {
	it("light theme renders as authored on a white canvas, no invert", () => {
		const css = generateFramedEmailBaseCSS(false, false);
		assert.match(css, /background-color:#ffffff/);
		assert.match(css, /color-scheme:light/);
		assert.doesNotMatch(css, /invert/);
	});

	it("dark theme without opt-in smart-inverts to darken into the pane", () => {
		const css = generateFramedEmailBaseCSS(true, false);
		assert.match(css, /filter:invert\(0\.92\) hue-rotate\(180deg\)/);
		// Media re-inverted back to natural color.
		assert.match(css, /img,picture,video[^{]*\{filter:invert/);
	});

	it("dark theme WITH opt-in preserves the author's own dark design (no invert)", () => {
		const css = generateFramedEmailBaseCSS(true, true);
		assert.match(css, /color-scheme:dark light/);
		assert.doesNotMatch(css, /invert/);
	});
});

describe("DARK_OPT_IN_RE", () => {
	it("detects color-scheme: dark and prefers-color-scheme: dark", () => {
		assert.ok(DARK_OPT_IN_RE.test(":root{color-scheme: dark}"));
		assert.ok(
			DARK_OPT_IN_RE.test("@media (prefers-color-scheme: dark){body{}}"),
		);
	});

	it("does not match a plain light email", () => {
		assert.ok(!DARK_OPT_IN_RE.test("<p>hello</p>"));
	});
});

describe("buildEmailSrcDoc", () => {
	it("prepends the viewport meta so author width=device-width resolves to the frame", () => {
		const doc = buildEmailSrcDoc("<p>x</p>", "plain", false);
		assert.ok(doc.startsWith(VIEWPORT_META));
	});

	it("keeps the sanitized email body intact after the injected style", () => {
		const body = '<style>.clamp{}</style><table width="600"></table>';
		const doc = buildEmailSrcDoc(body, "framed", false);
		assert.ok(doc.endsWith(body));
	});

	it("uses the plain base CSS for the plain variant", () => {
		const doc = buildEmailSrcDoc("<p>x</p>", "plain", false);
		assert.match(doc, /Plain-email base/);
	});

	it("uses the framed smart-invert in dark mode for a non-opt-in framed email", () => {
		const doc = buildEmailSrcDoc("<p>x</p>", "framed", true);
		assert.match(doc, /filter:invert\(0\.92\)/);
	});

	it("preserves a framed email's own dark design without inverting", () => {
		const doc = buildEmailSrcDoc(
			"<style>:root{color-scheme:dark}</style><p>x</p>",
			"framed",
			true,
		);
		assert.match(doc, /color-scheme:dark light/);
		assert.doesNotMatch(doc, /filter:invert/);
	});
});
