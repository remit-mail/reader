/**
 * #684: the image node the composer registers, driven the way the editor drives
 * it — mounted on a real root element, so what is asserted is the picture the
 * writer sees, and reopened from its own serialization, so it is the draft that
 * comes back rather than the document that was saved.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	$getRoot,
	$insertNodes,
	$isElementNode,
	createEditor,
	type ElementNode,
	type LexicalEditor,
} from "lexical";
import { $adoptHtml, $readRichText } from "./rich-text-document.js";
import { ImageNode } from "./rich-text-image-node.js";
import { RICH_TEXT_NODES, richTextTheme } from "./rich-text-nodes.js";

const LOGO = "https://example.com/logo.png";
const PIXEL =
	"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const PASTED = `<p>Chart: <img src="${LOGO}" alt="The logo"></p>`;

const openEditor = (html: string) => {
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

const imageOf = (editor: LexicalEditor) => {
	const image = editor.getRootElement()?.querySelector("img");
	if (!image) throw new Error("the editor is showing no image");
	return image;
};

const $theImage = (): ImageNode => {
	const found: ImageNode[] = [];
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

const readHtml = (editor: LexicalEditor) =>
	editor.read(() => $readRichText(editor)).html;
const readText = (editor: LexicalEditor) =>
	editor.read(() => $readRichText(editor)).text;

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
