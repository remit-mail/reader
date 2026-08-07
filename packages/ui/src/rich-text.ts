/**
 * The rich-text editor and nothing else. Its own entry point so an app can load
 * it on demand: reached through the package barrel it would land in whichever
 * chunk already imports `@remit/ui`, which is every screen.
 */
export {
	RichTextEditor,
	type RichTextEditorProps,
} from "./components/rich-text-editor.js";
export {
	EMPTY_RICH_TEXT,
	type RichTextValue,
} from "./components/rich-text-value.js";
