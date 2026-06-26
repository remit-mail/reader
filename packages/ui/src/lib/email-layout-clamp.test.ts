import assert from "node:assert";
import { describe, test } from "node:test";
import { generateLayoutClampCSS } from "./email-layout-clamp.js";

/**
 * Layout-clamp CSS injected alongside sanitized email HTML. Asserts on
 * substrings — the goal is to lock in the rules that close #374 / #727 (mobile
 * horizontal overflow when author markup is wider than the viewport). If any of
 * these get dropped, wide tables / images / long URLs would start unlocking
 * horizontal page scroll again.
 *
 * The sanitizer drops the email body straight into the iframe with no
 * `.email-content` wrapper, so the rules target the document's own
 * `html`/`body` and bare element selectors — a wrapper-scoped selector would
 * never match and the clamp would silently do nothing (the original #727 bug).
 *
 * Pure string assertions — no DOM required, intentionally separate from
 * `email-sanitizer.test.ts` because importing `email-sanitizer.ts` in plain
 * Node fails on its eager `DOMPurify()` call at module load.
 */
describe("generateLayoutClampCSS (#374 / #727)", () => {
	const css = generateLayoutClampCSS();

	test("targets the document body directly, not a wrapper that never exists", () => {
		// The sanitized email has no `.email-content` element — scoping there
		// was the #727 bug (dead CSS). Rules must hit bare element selectors.
		assert.ok(
			!css.includes(".email-content"),
			"clamp rules must not be scoped to a non-existent .email-content wrapper",
		);
	});

	test("zeros UA default html/body margin so iframe content fills edge-to-edge", () => {
		assert.ok(
			/html\s*,\s*body\s*\{[^}]*margin\s*:\s*0/.test(css),
			"html, body margin must be reset to 0",
		);
		assert.ok(
			/html\s*,\s*body\s*\{[^}]*padding\s*:\s*0/.test(css),
			"html, body padding must be reset to 0",
		);
	});

	test("clamps the document to the iframe width and wraps long tokens", () => {
		assert.ok(css.includes("max-width: 100%"));
		assert.ok(css.includes("overflow-wrap: anywhere"));
		assert.ok(css.includes("word-break: break-word"));
	});

	test("forces wide media (img/video/iframe) to fit the frame", () => {
		assert.ok(/(^|\s)img\s*,/.test(css) || /\bimg\b/.test(css));
		assert.ok(/\bvideo\b/.test(css));
		assert.ok(/\biframe\b/.test(css));
		// Author markup often sets `width="900"` — without !important we lose
		// the cascade and the image overflows again.
		assert.ok(
			css.includes("max-width: 100% !important"),
			"images need !important to override author width attributes",
		);
	});

	test("clamps fixed-width newsletter tables", () => {
		assert.ok(/\btable\b/.test(css));
		assert.ok(
			css.includes("max-width: 100% !important"),
			"author <table width='600'> must be capped to the frame width",
		);
		assert.ok(css.includes("table-layout: auto"));
	});

	test("clamps fixed-width table cells (the real width carriers in newsletters)", () => {
		// Newsletters pin widths on `<td width="600">`, not just the table.
		assert.ok(
			/\btd\s*,\s*th\b/.test(css),
			"td, th must be capped to the frame",
		);
		assert.ok(
			/td\s*,\s*th\s*\{[^}]*max-width:\s*100%\s*!important/.test(css),
			"cell widths need !important to override author width attributes",
		);
	});

	test("zeros min-width so children can shrink below their intrinsic width", () => {
		// `max-width` alone can't override an inline `min-width`; flex/grid/table
		// children won't collapse without this.
		assert.ok(
			/\*\s*\{[^}]*min-width:\s*0/.test(css),
			"a universal min-width:0 must let wide children shrink to the clamp",
		);
	});

	test("wraps long unbroken lines in pre/code blocks", () => {
		assert.ok(/\bpre\b/.test(css));
		assert.ok(/\bcode\b/.test(css));
		assert.ok(css.includes("white-space: pre-wrap"));
	});

	test("does not touch colors or backgrounds (layout-only, by design)", () => {
		// If any of these slip in, this stylesheet starts overlapping with
		// the dark-mode / smart-invert CSS and the rule set is no longer
		// scoped to the bug we're fixing. Keep it laser-focused on width/wrap.
		assert.ok(!/\bcolor\s*:/.test(css), "no color rules in layout clamp");
		assert.ok(
			!/\bbackground(-color)?\s*:/.test(css),
			"no background rules in layout clamp",
		);
		assert.ok(!/\bfont-/.test(css), "no font rules in layout clamp");
	});
});
