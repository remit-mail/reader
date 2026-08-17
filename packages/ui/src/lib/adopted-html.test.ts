/**
 * The paste profile decides what a message this app sends may contain. It runs
 * over content nobody here wrote — a web page, another mail client, Word — so
 * the fixtures below are the shapes those actually put on the clipboard.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeAdoptedHtml, sanitizeQuotedHtml } from "./adopted-html.js";

describe("sanitizeAdoptedHtml", () => {
	it("keeps the structure a pasted document is made of", () => {
		const result = sanitizeAdoptedHtml(
			[
				"<h2>Quarterly numbers</h2>",
				"<ul><li>Revenue up</li><li>Costs flat</li></ul>",
				"<table><thead><tr><th>Region</th><th>Total</th></tr></thead>",
				'<tbody><tr><td colspan="2">EMEA 412</td></tr></tbody></table>',
				"<blockquote><p>As discussed</p></blockquote>",
				"<pre><code>npm run build</code></pre>",
				"<hr>",
			].join(""),
		);

		assert.match(result, /<h2>Quarterly numbers<\/h2>/);
		assert.match(result, /<li>Revenue up<\/li>/);
		assert.match(result, /<th>Region<\/th>/);
		assert.match(result, /colspan="2"/);
		assert.match(result, /<blockquote>/);
		assert.match(result, /<pre>/);
		assert.match(result, /<hr>/);
	});

	it("keeps each div on its own line", () => {
		const result = sanitizeAdoptedHtml("<div>first</div><div>second</div>");
		assert.match(result, /<div>first<\/div><div>second<\/div>/);
	});

	it("keeps the language and direction a passage was written in", () => {
		const result = sanitizeAdoptedHtml(
			'<p>Hoi</p><p lang="fr">Bonjour</p><p dir="rtl" lang="ar">مرحبا</p>',
		);
		assert.match(result, /<p lang="fr">Bonjour<\/p>/);
		assert.match(result, /lang="ar"/);
		assert.match(result, /dir="rtl"/);
	});

	it("drops script, style and the presentation a receiving client rewrites", () => {
		const result = sanitizeAdoptedHtml(
			[
				"<style>.x{color:red}</style>",
				"<script>alert(1)</script>",
				'<p class="x" id="y" data-track="z" style="color:red" onclick="steal()">Hello</p>',
				'<span style="font-size:48px">world</span>',
			].join(""),
		);

		assert.equal(result.includes("<script"), false);
		assert.equal(result.includes("<style"), false);
		assert.equal(result.includes("color:red"), false);
		assert.equal(result.includes("onclick"), false);
		assert.equal(result.includes("class="), false);
		assert.equal(result.includes("data-track"), false);
		assert.match(result, /Hello/);
		assert.match(result, /world/);
	});

	it("drops Word's conditional markup and comments", () => {
		const result = sanitizeAdoptedHtml(
			"<!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]--><p>Memo</p>",
		);
		assert.equal(result.includes("WordDocument"), false);
		assert.match(result, /<p>Memo<\/p>/);
	});

	it("keeps mail and web links and defuses every other scheme", () => {
		const result = sanitizeAdoptedHtml(
			[
				'<a href="https://example.com/a">web</a>',
				'<a href="mailto:ada@example.com">mail</a>',
				'<a href="javascript:alert(1)">bad</a>',
				'<a href="file:///etc/passwd">local</a>',
			].join(""),
		);

		assert.match(result, /href="https:\/\/example.com\/a"/);
		assert.match(result, /href="mailto:ada@example.com"/);
		assert.equal(result.includes("javascript:"), false);
		assert.equal(result.includes("file:"), false);
		assert.match(result, /bad/);
	});

	it("keeps images the recipient can actually load", () => {
		const result = sanitizeAdoptedHtml(
			[
				'<img src="https://example.com/logo.png" alt="Logo">',
				'<img src="data:image/png;base64,iVBORw0KGgo=" alt="Inline">',
				'<img src="http://example.com/tracker.gif" alt="Tracker">',
				'<img src="cid:part1" alt="Attached">',
			].join(""),
		);

		assert.match(result, /src="https:\/\/example.com\/logo.png"/);
		assert.match(result, /src="data:image\/png;base64,/);
		assert.equal(result.includes("tracker.gif"), false);
		assert.equal(result.includes("cid:part1"), false);
	});

	it("caps an image at the width the recipient has for it", () => {
		const result = sanitizeAdoptedHtml(
			'<img src="https://example.com/screenshot.png" width="1600">',
		);

		assert.match(result, /style="max-width:100%;height:auto"/);
		assert.equal(result.includes("1600"), false);
	});

	it("writes that cap itself rather than trusting the source", () => {
		const result = sanitizeAdoptedHtml(
			[
				'<img src="https://example.com/a.png" style="width:1600px;border:8px solid red">',
				'<p style="color:red">Text</p>',
			].join(""),
		);

		assert.equal(result.includes("1600px"), false);
		assert.equal(result.includes("border"), false);
		assert.equal(result.includes("color:red"), false);
		assert.match(result, /<img src="https:\/\/example.com\/a.png"/);
	});
});

describe("sanitizeQuotedHtml", () => {
	it("sends a quoted link to its own context", () => {
		const result = sanitizeQuotedHtml('<a href="https://example.com">go</a>');
		assert.match(result, /target="_blank"/);
		assert.match(result, /rel="noopener noreferrer nofollow"/);
	});

	it("applies the same allowlist as an ordinary paste", () => {
		const result = sanitizeQuotedHtml(
			'<p style="color:red">Hi</p><script>alert(1)</script>',
		);
		assert.equal(result.includes("<script"), false);
		assert.equal(result.includes("color:red"), false);
	});
});
