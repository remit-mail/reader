/**
 * #671: pasting a web page into compose put its HTML source into the message.
 * Structure only survives when the editor has a node registered for the element
 * it came from, so this drives the same pipeline the paste handler does —
 * sanitize, parse, convert — and reads the document back out as the HTML that
 * would be sent.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type { LexicalEditor } from "lexical";

const PASTED_IMAGE = [
	"<p>before</p>",
	'<p><img src="https://example.com/logo.png" alt="The logo"></p>',
	"<p>after</p>",
].join("");

const PIXEL =
	"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const PASTED = [
	'<meta charset="utf-8">',
	'<h2 style="color:#111">Quarterly numbers</h2>',
	"<p>Highlights <strong>this quarter</strong>:</p>",
	"<ul><li>Revenue up</li><li>Costs flat</li></ul>",
	"<table><thead><tr><th>Region</th><th>Total</th></tr></thead>",
	"<tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>",
	"<script>alert(1)</script>",
].join("");

let adoptAndSerialize: (html: string) => { html: string; text: string };

before(async () => {
	const { JSDOM: JSDOMCtor } = await import("jsdom");
	const dom: JSDOM = new JSDOMCtor(
		"<!doctype html><html><body></body></html>",
		{ url: "http://localhost/" },
	);
	globalThis.window = dom.window as unknown as typeof globalThis.window;
	globalThis.document = dom.window.document;
	globalThis.DOMParser = dom.window.DOMParser;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Element = dom.window.Element;
	globalThis.Node = dom.window.Node;

	const { $getRoot, $insertNodes, createEditor } = await import("lexical");
	const { $adoptHtml, $readRichText } = await import("./rich-text-document.js");
	const { RICH_TEXT_NODES } = await import("./rich-text-nodes.js");

	adoptAndSerialize = (html: string) => {
		const editor: LexicalEditor = createEditor({
			namespace: "test",
			nodes: [...RICH_TEXT_NODES],
			onError: (error) => {
				throw error;
			},
		});
		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				root.select();
				$insertNodes($adoptHtml(editor, html));
			},
			{ discrete: true },
		);
		return editor.read(() => $readRichText(editor));
	};
});

describe("adopting pasted HTML", () => {
	it("keeps the heading, the list and the table", () => {
		const { html } = adoptAndSerialize(PASTED);

		assert.match(html, /<h2/);
		assert.match(html, /Quarterly numbers/);
		assert.match(html, /<ul/);
		assert.match(html, /Revenue up/);
		assert.match(html, /<table/);
		assert.match(html, /EMEA/);
		assert.match(html, /412/);
		assert.match(html, /<strong/);
	});

	it("never carries the markup through as characters", () => {
		const { html, text } = adoptAndSerialize(PASTED);

		assert.equal(html.includes("&lt;h2"), false);
		assert.equal(text.includes("<h2"), false);
		assert.equal(text.includes("<table"), false);
	});

	it("leaves out the script and the author's presentation", () => {
		const { html, text } = adoptAndSerialize(PASTED);

		assert.equal(html.includes("<script"), false);
		assert.equal(text.includes("alert(1)"), false);
		assert.equal(html.includes("color:#111"), false);
	});

	it("leaves out this app's own presentation too", () => {
		const { html } = adoptAndSerialize(PASTED);

		assert.equal(html.includes('class="'), false);
		assert.equal(html.includes("white-space"), false);
		assert.equal(html.includes("style="), false);
	});

	it("writes the plain alternative as Markdown", () => {
		const { text } = adoptAndSerialize(PASTED);

		assert.match(text, /## Quarterly numbers/);
		assert.match(text, /- Revenue up/);
		assert.match(text, /\*\*this quarter\*\*/);
	});
});

/**
 * #684: the sanitizer admitted the element and the editor had nowhere to put
 * it, so the picture was gone by the time the paste landed — between two
 * paragraphs that both survived.
 */
describe("adopting a pasted image", () => {
	it("keeps the image between the text around it", () => {
		const { html } = adoptAndSerialize(PASTED_IMAGE);

		assert.match(html, /<img[^>]+src="https:\/\/example\.com\/logo\.png"/);
		assert.match(html, /<img[^>]+alt="The logo"/);
		assert.match(html, /before/);
		assert.match(html, /after/);
	});

	it("keeps an image the clipboard carried as its own data", () => {
		const { html } = adoptAndSerialize(
			`<p><img src="${PIXEL}" alt="A pixel"></p>`,
		);

		assert.ok(html.includes(`src="${PIXEL}"`));
		assert.match(html, /alt="A pixel"/);
	});

	it("sends the image with a width the recipient's layout survives", () => {
		const { html } = adoptAndSerialize(PASTED_IMAGE);

		assert.match(html, /<img[^>]+style="max-width:100%;height:auto"/);
	});

	it("drops an image this app would not send", () => {
		const { html } = adoptAndSerialize(
			'<p><img src="http://tracker.example/px.gif"></p>',
		);

		assert.equal(html.includes("<img"), false);
	});
});
