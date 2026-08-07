import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import type { LexicalEditor, LexicalNode } from "lexical";
import { sanitizeAdoptedHtml } from "../lib/adopted-html.js";
import type { RichTextValue } from "./rich-text-value.js";

export const $adoptHtml = (
	editor: LexicalEditor,
	html: string,
): LexicalNode[] => {
	const document = new DOMParser().parseFromString(
		sanitizeAdoptedHtml(html),
		"text/html",
	);
	return $generateNodesFromDOM(editor, document);
};

/**
 * Lexical's export writes the editor's own theme onto every element — the app's
 * Tailwind class names, a `white-space` span around each text run, computed
 * table widths. None of that means anything in a recipient's client, so the
 * outgoing document goes back through the same profile a paste comes in
 * through.
 */
export const $readRichText = (editor: LexicalEditor): RichTextValue => ({
	html: sanitizeAdoptedHtml($generateHtmlFromNodes(editor, null)),
	text: $convertToMarkdownString(TRANSFORMERS),
});
