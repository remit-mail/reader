import assert from "node:assert";
import { describe, test } from "node:test";
import { generatePlainEmailBaseCSS } from "./email-plain-base";

/**
 * Base CSS injected into plain-email iframes. This is the owner's headline
 * dark-mode fix (#424): plain/weakly-marked emails get the UI sans-serif and
 * theme-aware text colors so black-on-dark is no longer unreadable.
 *
 * These assertions pin:
 *   - the resolved oklch token values per theme (hand-copied from
 *     packages/ui/src/tokens.css — if the tokens drift, this fails
 *     loudly instead of silently rendering the wrong color), and
 *   - the structural rules (font stack, color-strip reset, themed body
 *     background) the fix depends on.
 *
 * Pure string assertions — no DOM needed.
 */
describe("generatePlainEmailBaseCSS (#424)", () => {
	describe("dark theme", () => {
		const css = generatePlainEmailBaseCSS(true);

		test("uses the dark --fg token (oklch 0.88 0.02 90)", () => {
			assert.ok(
				css.includes("oklch(0.88 0.02 90)"),
				"dark fg token must be present",
			);
		});

		test("uses the dark --surface token (oklch 0.25 0.025 220)", () => {
			assert.ok(
				css.includes("oklch(0.25 0.025 220)"),
				"dark surface token must be present",
			);
		});

		test("uses the dark --accent token for links (oklch 0.78 0.16 150)", () => {
			assert.ok(
				css.includes("oklch(0.78 0.16 150)"),
				"dark accent token must be present",
			);
		});

		test("does not leak the light --fg token", () => {
			assert.ok(
				!css.includes("oklch(0.3 0.025 235)"),
				"light fg token must NOT appear in the dark stylesheet",
			);
		});
	});

	describe("light theme", () => {
		const css = generatePlainEmailBaseCSS(false);

		test("uses the light --fg token (oklch 0.3 0.025 235)", () => {
			assert.ok(
				css.includes("oklch(0.3 0.025 235)"),
				"light fg token must be present",
			);
		});

		test("uses the light --surface token (oklch 0.975 0.012 90)", () => {
			assert.ok(
				css.includes("oklch(0.975 0.012 90)"),
				"light surface token must be present",
			);
		});

		test("uses the light --accent token for links (oklch 0.55 0.14 150)", () => {
			assert.ok(
				css.includes("oklch(0.55 0.14 150)"),
				"light accent token must be present",
			);
		});

		test("does not leak the dark --fg token", () => {
			assert.ok(
				!css.includes("oklch(0.88 0.02 90)"),
				"dark fg token must NOT appear in the light stylesheet",
			);
		});
	});

	describe("structural rules (theme-independent)", () => {
		const css = generatePlainEmailBaseCSS(false);

		test("imposes the UI sans-serif font stack", () => {
			assert.ok(
				css.includes("Geist Variable"),
				"font stack must lead with the UI variable font",
			);
			assert.ok(
				css.includes("sans-serif"),
				"font stack must fall back to a generic sans-serif",
			);
		});

		test("includes a color-strip reset so author colors don't survive", () => {
			// The reset forces both text color (inherit) and element
			// backgrounds (transparent) — this is what neutralises author
			// `color:#000`-on-dark and bright author slabs.
			assert.ok(
				css.includes("color: inherit !important"),
				"color reset must be !important to beat author inline styles",
			);
			assert.ok(
				css.includes("background-color: transparent !important"),
				"background reset must be !important to strip author slabs",
			);
		});

		test("scopes the strip reset to body descendants so the themed body background survives", () => {
			// Regression guard: a bare `* { background: transparent !important }`
			// would clobber the `html, body { background-color: <surface> }`
			// rule (PR #482 review should-fix #1). The reset must target
			// `body *`, not `*`.
			assert.ok(
				css.includes("body * {"),
				"strip reset must be scoped to `body *`",
			);
			// A bare universal rule starts the selector with `*` (after a `}`,
			// a comment close, or a line start) — as opposed to `body *`, where
			// `*` is preceded by an identifier. Forbid the former only.
			assert.ok(
				!/(^|\}|\*\/)\s*\*\s*\{/m.test(css),
				"must not contain a bare universal `* {` selector",
			);
		});

		test("themes the body background with the surface token", () => {
			// The themed body background must use the surface token and must
			// NOT be overridden to transparent (see scoping test above).
			assert.ok(
				/html,\s*body\s*\{[\s\S]*background-color:\s*oklch/.test(css),
				"html, body must set a themed surface background",
			);
		});
	});
});
