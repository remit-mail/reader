import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	buildEmailSrcDoc,
	DARK_OPT_IN_RE,
	generateContentInsetCSS,
	generateFramedEmailBaseCSS,
	generatePlainEmailBaseCSS,
	generateScrollportCSS,
	VIEWPORT_META,
} from "./email-frame-css.js";
import {
	IsolatedEmailFrame,
	measureContentAxis,
} from "./isolated-email-frame.js";

const SHORT_MAIL = "<p>Thursday works. See you at one.</p>";

// The shape the frame used to measure itself against: a table wider than any
// reading column, with a `min-width` the clamp cannot collapse.
const WIDE_MAIL =
	'<table width="2400"><tr><td width="2400" style="min-width:2400px">' +
	"<p>A ledger nobody can reflow.</p></td></tr></table>";

const renderFrame = (html: string): string =>
	renderToString(
		createElement(IsolatedEmailFrame, {
			html,
			variant: "framed",
			isDark: false,
			declares: { background: true, spacing: true },
		}),
	);

/**
 * The style the iframe ELEMENT carries. The email's own markup rides along in
 * `srcdoc`, quotes and all, so it goes before anything reads an attribute off
 * the element.
 */
const frameStyle = (html: string): string => {
	const element = renderFrame(html).replace(/srcdoc="[^"]*"/, "");
	return /style="([^"]*)"/.exec(element)?.[1] ?? "";
};

describe("the frame's box is the app's layout, never the mail's", () => {
	it("takes the width of the box holding it", () => {
		assert.match(frameStyle(SHORT_MAIL), /width:100%/);
	});

	it("gives mail that cannot fit the same box as mail that can", () => {
		// The whole width policy in one assertion: nothing about the email
		// reaches the element the app has laid out, so no mail can move a box
		// the reader can see.
		assert.equal(frameStyle(WIDE_MAIL), frameStyle(SHORT_MAIL));
	});

	it("never resolves a width off the mail's own markup", () => {
		assert.doesNotMatch(frameStyle(WIDE_MAIL), /2400/);
	});

	it("holds no scrollport of its own", () => {
		// A frame that scrolled would put the email's overflow in the app's
		// chrome. The document inside it owns that, via the scrollport CSS.
		assert.doesNotMatch(frameStyle(WIDE_MAIL), /overflow/);
		assert.ok(
			renderFrame(WIDE_MAIL).includes(generateScrollportCSS()),
			"the document the frame carries is the one that scrolls",
		);
	});
});

describe("measureContentAxis (the frame's height, and only its height)", () => {
	it("takes the larger of body and documentElement scroll size", () => {
		assert.equal(measureContentAxis(600, 900, 50_000), 900);
		assert.equal(measureContentAxis(900, 600, 50_000), 900);
	});

	it("rounds UP so a fractional content size never leaves a 1px phantom overflow", () => {
		assert.equal(measureContentAxis(600.1, 0, 50_000), 601);
		assert.equal(measureContentAxis(0, 899.4, 50_000), 900);
	});

	it("caps at the supplied max so a hostile sender can't allocate unbounded layout", () => {
		assert.equal(measureContentAxis(50_001, 0, 50_000), 50_000);
		assert.equal(measureContentAxis(0, 25_000, 10_000), 10_000);
	});

	it("returns an exact integer for already-integral content (no spurious +1)", () => {
		assert.equal(measureContentAxis(672, 0, 50_000), 672);
		assert.equal(measureContentAxis(0, 0, 50_000), 0);
	});
});

describe("generateScrollportCSS (the document holds its own overflow)", () => {
	it("makes the body the scrollport rather than the frame", () => {
		assert.match(generateScrollportCSS(), /body\{overflow-x:auto\}/);
	});

	it("stops the body's overflow propagating to the frame's viewport", () => {
		// Overflow on the body becomes the viewport's unless the root claims it
		// first, and a scrolling viewport is the app holding the email's width
		// again.
		assert.match(generateScrollportCSS(), /html\{overflow:hidden\}/);
	});
});

describe("generatePlainEmailBaseCSS (theme tokens pinned)", () => {
	it("injects the light-theme resolved tokens", () => {
		const css = generatePlainEmailBaseCSS(false);
		assert.match(css, /oklch\(0\.3 0\.025 235\)/);
		assert.match(css, /oklch\(0\.55 0\.14 150\)/);
	});

	it("injects the dark-theme resolved tokens", () => {
		const css = generatePlainEmailBaseCSS(true);
		assert.match(css, /oklch\(0\.88 0\.02 90\)/);
		assert.match(css, /oklch\(0\.78 0\.16 150\)/);
	});

	it("grounds the email on the reading pane's own canvas, not a lighter surface", () => {
		// --surface (0.975 / 0.25) would render the mail as a lighter rectangle
		// inside the pane, seam and all. --canvas is the pane itself.
		assert.match(generatePlainEmailBaseCSS(false), /oklch\(0\.96 0\.015 90\)/);
		assert.doesNotMatch(
			generatePlainEmailBaseCSS(false),
			/oklch\(0\.975 0\.012 90\)/,
		);
		assert.match(generatePlainEmailBaseCSS(true), /oklch\(0\.22 0\.025 220\)/);
		assert.doesNotMatch(
			generatePlainEmailBaseCSS(true),
			/oklch\(0\.25 0\.025 220\)/,
		);
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
	it("light theme renders an author background as authored on white, no invert", () => {
		const css = generateFramedEmailBaseCSS(false, false, true);
		assert.match(css, /background-color:#ffffff/);
		assert.match(css, /color-scheme:light/);
		assert.doesNotMatch(css, /invert/);
	});

	it("dark theme without opt-in smart-inverts an author background into the pane", () => {
		const css = generateFramedEmailBaseCSS(true, false, true);
		assert.match(css, /html\{[^}]*filter:invert\(0\.92\) hue-rotate\(180deg\)/);
		// Media re-inverted back to natural color.
		assert.match(css, /img,picture,video[^{]*\{filter:invert/);
	});

	it("dark theme WITH opt-in preserves the author's own dark design (no invert)", () => {
		const css = generateFramedEmailBaseCSS(true, true, true);
		assert.match(css, /color-scheme:dark light/);
		assert.doesNotMatch(css, /invert/);
	});
});

describe("generateFramedEmailBaseCSS (mail that brings no ground of its own)", () => {
	it("grounds a light-theme email on the pane's canvas instead of white", () => {
		const css = generateFramedEmailBaseCSS(false, false, false);
		assert.match(css, /background-color:oklch\(0\.96 0\.015 90\)/);
		assert.doesNotMatch(css, /#ffffff/);
	});

	it("grounds a dark-theme email on the pane's canvas and never inverts it", () => {
		// The invert moves off `html` onto `body`: the author's colours still
		// darken, but a white canvas is never painted for it to turn into a
		// charcoal slab sitting inside the pane.
		const css = generateFramedEmailBaseCSS(true, false, false);
		assert.match(
			css,
			/html\{margin:0;background-color:oklch\(0\.22 0\.025 220\)\}/,
		);
		assert.match(css, /body\{margin:0;filter:invert\(0\.92\)/);
		assert.doesNotMatch(css, /#ffffff/);
	});

	it("grounds a dark opt-in email on the pane's canvas", () => {
		const css = generateFramedEmailBaseCSS(true, true, false);
		assert.match(css, /background-color:oklch\(0\.22 0\.025 220\)/);
		assert.doesNotMatch(css, /invert/);
	});
});

describe("generateContentInsetCSS (breathing room inside the background)", () => {
	it("pads the element that carries the background, in its border box", () => {
		const css = generateContentInsetCSS();
		assert.match(css, /body\{padding:16px;box-sizing:border-box\}/);
	});

	it("leaves the document itself unpadded so the ground reaches the frame edge", () => {
		assert.match(generateContentInsetCSS(), /html\{padding:0\}/);
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
		const doc = buildEmailSrcDoc(body, "framed", false, {
			background: true,
			spacing: true,
		});
		assert.ok(doc.includes(body));
	});

	it("gives every email a scrollport of its own, whatever it declares", () => {
		for (const spacing of [true, false]) {
			const doc = buildEmailSrcDoc("<p>x</p>", "framed", false, {
				background: true,
				spacing,
			});
			assert.ok(doc.includes(generateScrollportCSS()));
		}
	});

	it("uses the plain base CSS for the plain variant", () => {
		const doc = buildEmailSrcDoc("<p>x</p>", "plain", false);
		assert.match(doc, /Plain-email base/);
	});

	it("uses the framed smart-invert in dark mode for a non-opt-in framed email", () => {
		const doc = buildEmailSrcDoc("<p>x</p>", "framed", true, {
			background: true,
			spacing: true,
		});
		assert.match(doc, /filter:invert\(0\.92\)/);
	});

	it("preserves a framed email's own dark design without inverting", () => {
		const doc = buildEmailSrcDoc(
			"<style>:root{color-scheme:dark}</style><p>x</p>",
			"framed",
			true,
			{ background: true, spacing: true },
		);
		assert.match(doc, /color-scheme:dark light/);
		assert.doesNotMatch(doc, /filter:invert/);
	});

	it("insets mail that lays out no spacing of its own, after everything else", () => {
		const doc = buildEmailSrcDoc("<p>x</p>", "plain", false, {
			background: false,
			spacing: false,
		});
		// Last in the document, so it outranks the layout clamp's `padding: 0`.
		assert.ok(doc.endsWith(`${generateContentInsetCSS()}</style>`));
	});

	it("gives a newsletter that spaces its own container no second helping", () => {
		const doc = buildEmailSrcDoc("<p>x</p>", "framed", false, {
			background: true,
			spacing: true,
		});
		assert.doesNotMatch(doc, /box-sizing:border-box/);
	});
});
