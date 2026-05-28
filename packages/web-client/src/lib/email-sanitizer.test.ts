import assert from "node:assert";
import { describe, test } from "node:test";
import { buildCidResolver } from "./cid-resolver";
import {
	detectAuthorBackground,
	sanitizeInlineStyle,
	sanitizeStyleElementCss,
} from "./email-sanitizer";

/**
 * Author CSS survives — the email body is rendered as a light-mode island
 * (see `MessageBody.tsx`'s `color-scheme: light` wrapper), so the sanitizer
 * must NOT rewrite color/background declarations or wrap author styles in a
 * `prefers-color-scheme` media query. These tests pin that contract; if any
 * dark-mode rewriting sneaks back in, newsletter designs go back to looking
 * broken in dark mode (#375).
 *
 * DOMPurify needs a DOM at module-load, so the bgcolor/attribute side of the
 * sanitizer is verified by the lack of any code that touches it (see
 * `email-sanitizer.ts`). The pure string transforms below cover the
 * inline-style and `<style>`-block paths.
 */

describe("sanitizeInlineStyle — author colors survive (#375)", () => {
	test("white background passes through unchanged", () => {
		const result = sanitizeInlineStyle("background:#fff;color:#000");
		assert.ok(
			result.includes("background:#fff"),
			"author light background must survive — it is the whole point of #375",
		);
		assert.ok(
			result.includes("color:#000"),
			"author dark text must survive — no more `color: inherit` rewrite",
		);
	});

	test("named-color background (white) is not stripped", () => {
		const result = sanitizeInlineStyle("background: white; color: black");
		assert.ok(result.includes("background: white"));
		assert.ok(result.includes("color: black"));
	});

	test("rgb() backgrounds are not transformed to transparent", () => {
		const result = sanitizeInlineStyle(
			"background-color: rgb(255, 255, 255); color: rgb(0, 0, 0)",
		);
		assert.ok(result.includes("rgb(255, 255, 255)"));
		assert.ok(result.includes("rgb(0, 0, 0)"));
	});

	test("border colors are not rewritten to currentColor", () => {
		const result = sanitizeInlineStyle("border: 1px solid #eee");
		assert.ok(result.includes("#eee"));
		assert.ok(!result.includes("currentColor"));
	});

	test("url() background images are neutered — privacy / read-tracker vector", () => {
		const result = sanitizeInlineStyle(
			"background: url(https://tracker.example/pixel.gif)",
		);
		assert.ok(!result.includes("tracker.example"));
		assert.ok(result.includes("none"));
	});

	test("expression() is stripped — legacy IE XSS vector", () => {
		const result = sanitizeInlineStyle("width: expression(alert(1))");
		assert.ok(!result.includes("expression"));
		assert.ok(!result.includes("alert"));
	});

	test("-moz-binding is stripped — legacy Firefox XSS vector", () => {
		const result = sanitizeInlineStyle("-moz-binding: url(evil.xml)");
		assert.ok(!result.includes("-moz-binding"));
		assert.ok(!result.includes("evil.xml"));
	});
});

describe("sanitizeStyleElementCss — author <style> blocks survive (#375)", () => {
	test("author body { background: white; color: black } is NOT wrapped in @media (prefers-color-scheme: light)", () => {
		const css = "body { background: white; color: black; }";
		const result = sanitizeStyleElementCss(css);
		assert.ok(
			!result.includes("@media"),
			"author CSS must not be hidden behind a media query — that was the bug",
		);
		assert.ok(!result.includes("prefers-color-scheme"));
		assert.ok(
			result.includes("background: white"),
			"author background survives in <style>",
		);
		assert.ok(
			result.includes("color: black"),
			"author color survives in <style>",
		);
	});

	test("author CSS pass-through preserves the whole declaration block", () => {
		const css = `
			.brand { background:#0066cc; color:#fff; padding:12px; }
			.muted { color:#666; }
		`;
		const result = sanitizeStyleElementCss(css);
		assert.ok(result.includes(".brand"));
		assert.ok(result.includes("#0066cc"));
		assert.ok(result.includes(".muted"));
		assert.ok(result.includes("#666"));
	});

	test("@import is neutered — remote stylesheet pulls leak the read event", () => {
		const css = "@import url('https://tracker.example/style.css');";
		const result = sanitizeStyleElementCss(css);
		assert.ok(!result.includes("tracker.example"));
		assert.ok(result.includes("@import blocked"));
	});

	test("url() inside CSS is neutered — same read-tracker vector", () => {
		const css =
			".hero { background-image: url(https://tracker.example/pixel.gif); }";
		const result = sanitizeStyleElementCss(css);
		assert.ok(!result.includes("tracker.example"));
	});

	test("expression() and -moz-binding are stripped from <style> too", () => {
		const css =
			".x { width: expression(alert(1)); -moz-binding: url(evil.xml); }";
		const result = sanitizeStyleElementCss(css);
		assert.ok(!result.includes("expression"));
		assert.ok(!result.includes("alert"));
		assert.ok(!result.includes("-moz-binding"));
		assert.ok(!result.includes("evil.xml"));
	});
});

describe("buildCidResolver (#224 PR 2)", () => {
	const PARTS = [
		{
			contentId: "<inline-1@example.com>",
			contentUrl:
				"https://cdn.test/content/accounts/cfg/acc/messages/m/parts/1",
		},
		{
			contentId: "inline-2@example.com",
			contentUrl:
				"https://cdn.test/content/accounts/cfg/acc/messages/m/parts/2",
		},
		{ contentUrl: "https://cdn.test/no-cid/parts/3" },
		{
			contentId: "<inline-blank>",
			contentUrl: "",
		},
	];

	test("looks up the URL by Content-ID, stripping angle brackets on both sides", () => {
		const resolve = buildCidResolver(PARTS);
		assert.equal(
			resolve("inline-1@example.com"),
			"https://cdn.test/content/accounts/cfg/acc/messages/m/parts/1",
		);
		assert.equal(
			resolve("<inline-1@example.com>"),
			"https://cdn.test/content/accounts/cfg/acc/messages/m/parts/1",
		);
	});

	test("matches Content-IDs that came in without angle brackets", () => {
		const resolve = buildCidResolver(PARTS);
		assert.equal(
			resolve("inline-2@example.com"),
			"https://cdn.test/content/accounts/cfg/acc/messages/m/parts/2",
		);
	});

	test("returns undefined when no body part has a matching Content-ID — fail-loud, do not silently substitute", () => {
		const resolve = buildCidResolver(PARTS);
		assert.equal(resolve("missing@example.com"), undefined);
	});

	test("skips parts without a contentId or with an empty contentUrl", () => {
		const resolve = buildCidResolver(PARTS);
		assert.equal(resolve("inline-blank"), undefined);
	});

	test("empty body-part list returns a resolver that always returns undefined", () => {
		const resolve = buildCidResolver([]);
		assert.equal(resolve("anything"), undefined);
	});
});

describe("detectAuthorBackground — designed-vs-plain mail discriminator (#375)", () => {
	test("inline style with background-color triggers (newsletter pattern)", () => {
		assert.equal(
			detectAuthorBackground(
				'<body style="background-color:#ffffff;color:#000">x</body>',
			),
			true,
		);
	});

	test("legacy bgcolor attribute triggers", () => {
		assert.equal(
			detectAuthorBackground(
				'<table bgcolor="#ffffff"><tr><td>x</td></tr></table>',
			),
			true,
		);
	});

	test("<style> block containing a background rule triggers", () => {
		assert.equal(
			detectAuthorBackground(
				"<style>body { background: white; }</style><p>x</p>",
			),
			true,
		);
	});

	test("plain mail with no author styling does NOT trigger — inherits app theme", () => {
		assert.equal(detectAuthorBackground("<p>hello</p>"), false);
	});

	test("author text colour alone does NOT trigger — only backgrounds do", () => {
		assert.equal(
			detectAuthorBackground(
				'<p style="color:#666">just a text color, no bg</p>',
			),
			false,
		);
	});

	test("inline style with shorthand `background:` (no -color) still triggers", () => {
		assert.equal(
			detectAuthorBackground('<div style="background:#eee">x</div>'),
			true,
		);
	});

	test("case-insensitive on the attribute and on background keyword", () => {
		assert.equal(
			detectAuthorBackground('<div STYLE="BACKGROUND:#eee">x</div>'),
			true,
		);
		assert.equal(detectAuthorBackground('<td BGCOLOR="#fff">x</td>'), true);
	});
});
