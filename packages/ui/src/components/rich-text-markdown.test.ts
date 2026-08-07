/**
 * `@lexical/markdown` exports `isTableRowDivider` and no table transformer, so
 * the composer supplies one. Both directions are pinned here: what a recipient
 * reads in the plain part of a rich send, and what comes back when a plain
 * draft is switched to rich.
 *
 * The same transformer set drives the down-conversion of a paste in plain mode,
 * so a table pasted there and a table pasted in rich mode and then switched
 * produce the same characters.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { JSDOM } from "jsdom";

const TABLE_HTML = [
	"<table><thead><tr><th>Region</th><th>Total</th></tr></thead>",
	"<tbody><tr><td>EMEA</td><td>412</td></tr>",
	"<tr><td>Americas</td><td>388</td></tr></tbody></table>",
].join("");

const TABLE_MARKDOWN = [
	"| Region | Total |",
	"| --- | --- |",
	"| EMEA | 412 |",
	"| Americas | 388 |",
].join("\n");

let htmlToMarkdown: (html: string) => string;
let markdownToHtml: (markdown: string) => string;

before(async () => {
	const { JSDOM: JSDOMCtor } = await import("jsdom");
	const dom: JSDOM = new JSDOMCtor(
		"<!doctype html><html><body></body></html>",
		{
			url: "http://localhost/",
		},
	);
	globalThis.window = dom.window as unknown as typeof globalThis.window;
	globalThis.document = dom.window.document;
	globalThis.DOMParser = dom.window.DOMParser;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Element = dom.window.Element;
	globalThis.Node = dom.window.Node;

	({ htmlToMarkdown, markdownToHtml } = await import(
		"./rich-text-document.js"
	));
});

describe("HTML down-converted for the plain surface", () => {
	it("writes a table as pipe rows under a divider", () => {
		assert.equal(htmlToMarkdown(TABLE_HTML).trim(), TABLE_MARKDOWN);
	});

	it("writes headings, lists and emphasis as Markdown", () => {
		const markdown = htmlToMarkdown(
			[
				"<h2>Release checklist</h2>",
				"<p>Ship <strong>Friday</strong>.</p>",
				"<ol><li>Cut the tag</li><li>Publish the images</li></ol>",
			].join(""),
		);

		assert.match(markdown, /## Release checklist/);
		assert.match(markdown, /\*\*Friday\*\*/);
		assert.match(markdown, /1\. Cut the tag/);
	});

	it("carries no markup through as characters", () => {
		const markdown = htmlToMarkdown(
			'<h2 style="color:#c00">Numbers</h2><script>alert(1)</script>',
		);

		assert.equal(markdown.includes("<h2"), false);
		assert.equal(markdown.includes("<script"), false);
		assert.equal(markdown.includes("alert(1)"), false);
		assert.equal(markdown.includes("color:#c00"), false);
	});

	it("keeps a cell's own pipe out of the row it sits in", () => {
		const markdown = htmlToMarkdown(
			"<table><tbody><tr><td>a|b</td><td>c</td></tr></tbody></table>",
		);
		const cells = markdownToHtml(markdown).match(/<t[dh][^>]*>/g) ?? [];

		assert.match(markdown, /a\\\|b/);
		assert.equal(cells.length, 2);
	});
});

describe("Markdown read back into a document", () => {
	it("renders a pipe table as a table with a header row", () => {
		const html = markdownToHtml(TABLE_MARKDOWN);

		assert.match(html, /<table/);
		assert.match(html, /<th[^>]*><p>Region/);
		assert.match(html, /EMEA/);
		assert.match(html, /388/);
	});

	it("renders a heading and emphasis", () => {
		const html = markdownToHtml("## Numbers\n\nDue **Friday**.");

		assert.match(html, /<h2/);
		assert.match(html, /<strong/);
	});

	it("returns a table unchanged over a round trip", () => {
		assert.equal(
			htmlToMarkdown(markdownToHtml(TABLE_MARKDOWN)).trim(),
			TABLE_MARKDOWN,
		);
	});

	it("leaves prose that matches no transformer looking the same", () => {
		const prose = "Thanks — that works.\n\nI'll send the deck tomorrow.";
		const html = markdownToHtml(prose);

		assert.equal((html.match(/<p>/g) ?? []).length, 2);
		assert.match(html, /Thanks/);
		assert.match(html, /send the deck tomorrow/);
	});
});
