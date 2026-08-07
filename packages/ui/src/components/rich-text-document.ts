import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
} from "@lexical/markdown";
import {
	$getRoot,
	$insertNodes,
	$isElementNode,
	$isTextNode,
	createEditor,
	type LexicalEditor,
	type LexicalNode,
	type TextFormatType,
} from "lexical";
import { sanitizeAdoptedHtml } from "../lib/adopted-html.js";
import { COMPOSE_TRANSFORMERS } from "./rich-text-markdown.js";
import { RICH_TEXT_NODES } from "./rich-text-nodes.js";
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
 * What survives a conversion to Markdown unchanged: a run of paragraphs, the
 * line breaks inside them, and unformatted characters. Anything else is
 * formatting that becomes visible syntax, or is lost outright.
 */
const PLAIN_NODE_TYPES = new Set(["root", "paragraph", "text", "linebreak"]);

const TEXT_FORMATS: readonly TextFormatType[] = [
	"bold",
	"italic",
	"strikethrough",
	"underline",
	"code",
	"subscript",
	"superscript",
	"highlight",
];

/**
 * Every node type and text format in the document that a plain-text
 * representation cannot carry, as an inventory rather than a verdict — the
 * caller decides what to do with a document that holds any.
 *
 * A comparison of the Markdown export against the plain text would be the
 * obvious rule and is the wrong one in both directions. `@lexical/markdown`
 * ships no underline transformer, so an underlined word exports identical to
 * its own characters and would be destroyed in silence; a trailing empty
 * paragraph makes the two strings differ and would raise a warning over
 * ordinary prose.
 */
export const $documentFormatting = (): string[] => {
	const found = new Set<string>();

	const visit = (node: LexicalNode): void => {
		const type = node.getType();
		if (!PLAIN_NODE_TYPES.has(type)) found.add(type);
		if ($isTextNode(node)) {
			for (const format of TEXT_FORMATS) {
				if (node.hasFormat(format)) found.add(format);
			}
		}
		if (!$isElementNode(node)) return;
		for (const child of node.getChildren()) visit(child);
	};

	visit($getRoot());
	return [...found].sort();
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
	text: $convertToMarkdownString(COMPOSE_TRANSFORMERS),
	formatting: $documentFormatting(),
});

/**
 * A document held only long enough to convert one representation into the
 * other. It is never attached to the DOM, so it has no theme, no history and
 * no plugins — only the node types the composer registers, which is what makes
 * the result the same document the editor would have produced.
 */
const scratchEditor = (): LexicalEditor =>
	createEditor({
		namespace: "compose-conversion",
		nodes: [...RICH_TEXT_NODES],
		onError: (error) => {
			throw error;
		},
	});

/** Adopted HTML as Markdown: a table as pipe rows, a heading as `##`. */
export const htmlToMarkdown = (html: string): string => {
	const editor = scratchEditor();
	editor.update(
		() => {
			const root = $getRoot();
			root.clear();
			root.select();
			$insertNodes($adoptHtml(editor, html));
		},
		{ discrete: true },
	);
	return editor.read(() => $convertToMarkdownString(COMPOSE_TRANSFORMERS));
};

/** Markdown as the HTML a rich draft stores and sends. */
export const markdownToHtml = (markdown: string): string => {
	const editor = scratchEditor();
	editor.update(
		() => {
			$convertFromMarkdownString(markdown, COMPOSE_TRANSFORMERS);
		},
		{ discrete: true },
	);
	return editor.read(() =>
		sanitizeAdoptedHtml($generateHtmlFromNodes(editor, null)),
	);
};
