/**
 * #684: the image node the composer registers, driven the way the editor drives
 * it — mounted on a real root element, so what is asserted is the picture the
 * writer sees, and reopened from its own serialization, so it is the draft that
 * comes back rather than the document that was saved.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type { ElementNode, LexicalEditor } from "lexical";
import type { ImageNode as ImageNodeClass } from "./rich-text-image-node.js";

const LOGO = "https://example.com/logo.png";
const PIXEL =
	"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const PASTED = `<p>Chart: <img src="${LOGO}" alt="The logo"></p>`;

let openEditor: (html: string) => LexicalEditor;
let imageOf: (editor: LexicalEditor) => HTMLImageElement;
let $theImage: () => ImageNodeClass;
let readHtml: (editor: LexicalEditor) => string;
let readText: (editor: LexicalEditor) => string;

before(async () => {
	const { JSDOM: JSDOMCtor } = await import("jsdom");
	const dom: JSDOM = new JSDOMCtor(
		"<!doctype html><html><body></body></html>",
		{ url: "http://localhost/", pretendToBeVisual: true },
	);
	globalThis.window = dom.window as unknown as typeof globalThis.window;
	globalThis.document = dom.window.document;
	globalThis.DOMParser = dom.window.DOMParser;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Element = dom.window.Element;
	globalThis.Node = dom.window.Node;
	globalThis.MutationObserver = dom.window.MutationObserver;
	globalThis.Range = dom.window.Range;
	globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

	const { $getRoot, $insertNodes, $isElementNode, createEditor } = await import(
		"lexical"
	);
	const { $adoptHtml, $readRichText } = await import("./rich-text-document.js");
	const { ImageNode } = await import("./rich-text-image-node.js");
	const { RICH_TEXT_NODES, richTextTheme } = await import(
		"./rich-text-nodes.js"
	);

	openEditor = (html: string) => {
		const editor: LexicalEditor = createEditor({
			namespace: "test",
			nodes: [...RICH_TEXT_NODES],
			onError: (error) => {
				throw error;
			},
			theme: richTextTheme,
		});
		const root = document.createElement("div");
		root.contentEditable = "true";
		document.body.appendChild(root);
		editor.setRootElement(root);
		if (html !== "")
			editor.update(
				() => {
					$getRoot().clear();
					$getRoot().select();
					$insertNodes($adoptHtml(editor, html));
				},
				{ discrete: true },
			);
		return editor;
	};

	imageOf = (editor: LexicalEditor) => {
		const image = editor.getRootElement()?.querySelector("img");
		if (!image) throw new Error("the editor is showing no image");
		return image;
	};

	$theImage = () => {
		const found: ImageNodeClass[] = [];
		const visit = (node: ElementNode) => {
			for (const child of node.getChildren()) {
				if (child instanceof ImageNode) found.push(child);
				if ($isElementNode(child)) visit(child);
			}
		};
		visit($getRoot());
		if (found.length !== 1)
			throw new Error(`the document holds ${found.length} images`);
		return found[0];
	};

	readHtml = (editor: LexicalEditor) =>
		editor.read(() => $readRichText(editor)).html;
	readText = (editor: LexicalEditor) =>
		editor.read(() => $readRichText(editor)).text;
});

describe("the image the composer shows", () => {
	it("draws the picture rather than a placeholder for it", () => {
		const image = imageOf(openEditor(PASTED));

		assert.equal(image.getAttribute("src"), LOGO);
		assert.equal(image.getAttribute("alt"), "The logo");
		assert.match(image.className, /max-w-full/);
	});

	it("stays on the line it was pasted into", () => {
		const html = readHtml(openEditor(PASTED));

		assert.match(html, /<p>Chart:\s*<img[^>]*><\/p>/);
	});

	it("leaves the text alternative to a reader who gets no picture", () => {
		assert.match(readText(openEditor(PASTED)), /The logo/);
	});
});

describe("editing a document that holds an image", () => {
	it("repoints the picture already on the screen", () => {
		const editor = openEditor(PASTED);
		const before = imageOf(editor);

		editor.update(() => $theImage().setSrc(PIXEL), { discrete: true });

		const after = imageOf(editor);
		assert.equal(after, before);
		assert.equal(after.getAttribute("src"), PIXEL);
	});

	it("carries the rest of the image through the edit", () => {
		const editor = openEditor(PASTED);

		editor.update(() => $theImage().setAlt("A newer logo"), {
			discrete: true,
		});

		const image = imageOf(editor);
		assert.equal(image.getAttribute("alt"), "A newer logo");
		assert.equal(image.getAttribute("src"), LOGO);
	});
});

describe("a draft that held an image", () => {
	it("reopens with the same picture in it", () => {
		const saved = JSON.stringify(openEditor(PASTED).getEditorState().toJSON());
		const reopened = openEditor("");

		reopened.setEditorState(reopened.parseEditorState(saved));

		const html = readHtml(reopened);
		assert.ok(html.includes(`src="${LOGO}"`));
		assert.match(html, /alt="The logo"/);
		assert.match(html, /Chart:/);
	});
});
