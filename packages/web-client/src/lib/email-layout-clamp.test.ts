import assert from "node:assert";
import { describe, test } from "node:test";
import { generateLayoutClampCSS } from "./email-layout-clamp";

/**
 * Layout-clamp CSS injected alongside sanitized email HTML. Asserts on
 * substrings — the goal is to lock in the rules that close #374 (mobile
 * horizontal overflow when author markup is wider than the viewport). If
 * any of these get dropped, wide tables / images / long URLs would start
 * unlocking horizontal page scroll again.
 *
 * Pure string assertions — no DOM required, intentionally separate from
 * `email-sanitizer.test.ts` because importing `email-sanitizer.ts` in plain
 * Node fails on its eager `DOMPurify()` call at module load.
 */
describe("generateLayoutClampCSS (#374)", () => {
	const css = generateLayoutClampCSS();

	test("scopes the rules to .email-content (does not leak to the app)", () => {
		assert.ok(
			css.includes(".email-content"),
			"clamp rules must be scoped to .email-content",
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

	test("clamps the .email-content block itself to its parent width", () => {
		assert.ok(css.includes("max-width: 100%"));
		assert.ok(css.includes("overflow-wrap: anywhere"));
		assert.ok(css.includes("word-break: break-word"));
	});

	test("forces wide media (img/video/iframe) to fit the column", () => {
		assert.ok(/\.email-content img/.test(css));
		assert.ok(/\.email-content video/.test(css));
		assert.ok(/\.email-content iframe/.test(css));
		// Author markup often sets `width="900"` — without !important we lose
		// the cascade and the image overflows again.
		assert.ok(
			css.includes("max-width: 100% !important"),
			"images need !important to override author width attributes",
		);
		assert.ok(css.includes("height: auto !important"));
	});

	test("clamps fixed-width newsletter tables", () => {
		assert.ok(/\.email-content table/.test(css));
		assert.ok(
			css.includes("width: auto !important"),
			"author <table width='600'> must be downgraded to auto",
		);
		assert.ok(css.includes("table-layout: auto"));
	});

	test("wraps long unbroken lines in pre/code blocks", () => {
		assert.ok(/\.email-content pre/.test(css));
		assert.ok(/\.email-content code/.test(css));
		assert.ok(css.includes("white-space: pre-wrap"));
	});

	test("does not touch colors or backgrounds (layout-only, by design)", () => {
		// If any of these slip in, this stylesheet starts overlapping with
		// the dark-mode override CSS and the rule set is no longer scoped
		// to the bug we're fixing. Keep it laser-focused on width/wrap.
		assert.ok(!/\bcolor\s*:/.test(css), "no color rules in layout clamp");
		assert.ok(
			!/\bbackground(-color)?\s*:/.test(css),
			"no background rules in layout clamp",
		);
		assert.ok(!/\bfont-/.test(css), "no font rules in layout clamp");
	});
});
