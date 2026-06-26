import assert from "node:assert";
import { describe, test } from "node:test";
import { classifyEmailRenderTreatment } from "./email-render-treatment.js";

/**
 * Render-treatment classification (#424). Locks the framed-vs-plain decision
 * that drives the owner's dark-mode fix: misclassifying a plain personal email
 * as `framed` would skip the theme-aware base CSS and reintroduce
 * black-text-on-dark.
 */
describe("classifyEmailRenderTreatment (#424)", () => {
	test("newsletter category → framed (designed mail, colors preserved)", () => {
		const t = classifyEmailRenderTreatment("newsletter", false);
		assert.strictEqual(t.framed, true);
		assert.strictEqual(t.isPlain, false);
	});

	test("marketing category → framed", () => {
		const t = classifyEmailRenderTreatment("marketing", false);
		assert.strictEqual(t.framed, true);
		assert.strictEqual(t.isPlain, false);
	});

	test("author background detected → framed even for a personal category", () => {
		const t = classifyEmailRenderTreatment("personal", true);
		assert.strictEqual(t.framed, true);
		assert.strictEqual(t.isPlain, false);
	});

	test("plain personal mail (no background) → isPlain (theme CSS applied)", () => {
		// Mirrors the `<p style="color:#000">…</p>` case: text-color only, no
		// background — the sanitizer returns hasAuthorBackground=false, so this
		// must classify as plain and receive the theme-aware base CSS.
		const t = classifyEmailRenderTreatment("personal", false);
		assert.strictEqual(t.framed, false);
		assert.strictEqual(t.isPlain, true);
	});

	test("undefined category, no background → isPlain (safe default for weak markup)", () => {
		const t = classifyEmailRenderTreatment(undefined, false);
		assert.strictEqual(t.framed, false);
		assert.strictEqual(t.isPlain, true);
	});

	test("undefined category WITH author background → framed", () => {
		const t = classifyEmailRenderTreatment(undefined, true);
		assert.strictEqual(t.framed, true);
		assert.strictEqual(t.isPlain, false);
	});

	test("automated/transactional/social categories with no background → isPlain", () => {
		for (const category of ["automated", "transactional", "social"] as const) {
			const t = classifyEmailRenderTreatment(category, false);
			assert.strictEqual(
				t.isPlain,
				true,
				`${category} with no background should be plain`,
			);
		}
	});

	test("framed and isPlain are always mutually exclusive", () => {
		const cases: Array<
			[Parameters<typeof classifyEmailRenderTreatment>[0], boolean]
		> = [
			["newsletter", false],
			["marketing", true],
			["personal", false],
			["personal", true],
			[undefined, false],
			[undefined, true],
		];
		for (const [category, bg] of cases) {
			const t = classifyEmailRenderTreatment(category, bg);
			assert.notStrictEqual(
				t.framed,
				t.isPlain,
				`framed and isPlain must differ for (${category}, ${bg})`,
			);
		}
	});
});
