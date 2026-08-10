/**
 * What the composer holds. `html` is what gets sent and what a draft stores —
 * not the editor's own JSON, which changes shape between Lexical versions.
 * `text` is the plain alternative, as Markdown over the same document.
 *
 * `formatting` is the inventory of node types and text formats in the document
 * that plain text cannot carry, sorted, empty for a document of ordinary
 * paragraphs. It is reported rather than reduced to a flag so the caller can
 * both decide and say what is at stake.
 *
 * Kept apart from the editor so a caller can name the shape without pulling
 * the editor, and its dependencies, out of their own chunk.
 */
export interface RichTextValue {
	html: string;
	text: string;
	formatting: readonly string[];
}

/**
 * Where a writing surface puts the caret when it takes focus on mount. Both
 * surfaces read it, so it lives with the value rather than with either one.
 */
export type ComposeCaret = "start" | "end";

export const EMPTY_RICH_TEXT: RichTextValue = {
	html: "",
	text: "",
	formatting: [],
};
