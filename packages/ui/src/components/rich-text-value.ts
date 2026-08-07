/**
 * What the composer holds. `html` is what gets sent and what a draft stores —
 * not the editor's own JSON, which changes shape between Lexical versions.
 * `text` is the plain alternative, as Markdown over the same document.
 *
 * Kept apart from the editor so a caller can name the shape without pulling
 * the editor, and its dependencies, out of their own chunk.
 */
export interface RichTextValue {
	html: string;
	text: string;
}

export const EMPTY_RICH_TEXT: RichTextValue = { html: "", text: "" };
