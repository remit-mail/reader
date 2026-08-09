/**
 * The rule that decides whether a message's formatting is destroyed without
 * asking. It fires on what the document holds, not on a comparison of the
 * Markdown export against the plain text: `@lexical/markdown` ships no
 * underline transformer, so an underlined word exports identical to its own
 * characters and a string comparison would switch in silence over exactly the
 * document this warning exists for. In the other direction a trailing empty
 * paragraph makes the two strings differ, and the same comparison would
 * interrupt the ordinary prose it is meant to leave alone.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type { LexicalEditor } from "lexical";

interface Row {
	what: string;
	html: string;
	/** What the switch does: warn first, or switch in silence. */
	warns: boolean;
	/** The formatting the document is expected to hold, when it holds any. */
	holds?: string[];
}

const ROWS: Row[] = [
	{ what: "an empty document", html: "", warns: false },
	{
		what: "one paragraph of prose",
		html: "<p>See you at 12:30.</p>",
		warns: false,
	},
	{
		what: "a double Enter between two paragraphs",
		html: "<p>First.</p><p></p><p>Second.</p>",
		warns: false,
	},
	{
		what: "a trailing empty paragraph",
		html: "<p>Thanks.</p><p></p>",
		warns: false,
	},
	{
		what: "a line break inside a paragraph",
		html: "<p>One<br>Two</p>",
		warns: false,
	},
	{
		what: "a bare URL left as characters",
		html: "<p>See https://example.com for the report.</p>",
		warns: false,
	},
	{
		what: "an image, which plain text can only name",
		html: '<p>Chart: <img src="https://example.com/chart.png" alt="chart"></p>',
		warns: true,
		holds: ["image"],
	},
	{
		what: "an underlined word",
		html: "<p>Please <u>read this</u>.</p>",
		warns: true,
		holds: ["underline"],
	},
	{
		what: "a bold word",
		html: "<p>Due <strong>Friday</strong>.</p>",
		warns: true,
		holds: ["bold"],
	},
	{
		what: "a URL Lexical turned into a link",
		html: '<p>See <a href="https://example.com">https://example.com</a>.</p>',
		warns: true,
		holds: ["link"],
	},
	{
		what: "a heading",
		html: "<h2>Quarterly numbers</h2><p>Below.</p>",
		warns: true,
		holds: ["heading"],
	},
	{
		what: "a table",
		html: "<table><tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>",
		warns: true,
	},
];

let formattingOf: (html: string) => string[];

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

	const { $getRoot, $insertNodes, createEditor } = await import("lexical");
	const { $adoptHtml, $documentFormatting } = await import(
		"./rich-text-document.js"
	);
	const { RICH_TEXT_NODES } = await import("./rich-text-nodes.js");

	formattingOf = (html: string) => {
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
				if (html !== "") $insertNodes($adoptHtml(editor, html));
			},
			{ discrete: true },
		);
		return editor.read(() => $documentFormatting());
	};
});

describe("what switching to plain text warns about", () => {
	for (const row of ROWS) {
		it(`${row.warns ? "warns about" : "says nothing about"} ${row.what}`, () => {
			const formatting = formattingOf(row.html);
			assert.equal(
				formatting.length > 0,
				row.warns,
				`formatting was ${JSON.stringify(formatting)}`,
			);
			if (row.holds) {
				for (const held of row.holds) assert.ok(formatting.includes(held));
			}
		});
	}

	it("names what a formatted document holds rather than reducing it to a flag", () => {
		assert.deepEqual(
			formattingOf("<p><strong>Due</strong> <em>Friday</em>.</p>"),
			["bold", "italic"],
		);
	});
});
