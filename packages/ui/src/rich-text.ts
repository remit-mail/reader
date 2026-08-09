/**
 * The compose writing surfaces and nothing else. Their own entry point so an
 * app can load them on demand: reached through the package barrel they would
 * land in whichever chunk already imports `@remit/ui`, which is every screen.
 */

export {
	ComposeBody,
	type ComposeBodyProps,
	type ComposeConversions,
	type ConversionFailure,
	DEFAULT_COMPOSE_CONVERSIONS,
} from "./components/compose-body.js";
export {
	ComposeLanguageChip,
	type ComposeLanguageChipProps,
} from "./components/compose-language-chip.js";
export {
	type ComposeBodyMode,
	ComposeModeToggle,
	type ComposeModeToggleProps,
} from "./components/compose-mode-toggle.js";
export {
	PlainTextEditor,
	type PlainTextEditorProps,
} from "./components/plain-text-editor.js";
export {
	type CorrectionMenuAnchor,
	RichTextCorrectionMenu,
	type RichTextCorrectionMenuProps,
} from "./components/rich-text-correction-menu.js";
export {
	htmlToMarkdown,
	markdownToHtml,
} from "./components/rich-text-document.js";
export {
	RichTextEditor,
	type RichTextEditorProps,
} from "./components/rich-text-editor.js";
export { COMPOSE_TRANSFORMERS } from "./components/rich-text-markdown.js";
export type {
	CheckRequest,
	CheckResponse,
	CheckSpan,
	Finding,
	LanguageTag,
	ProviderStatus,
	SpellcheckOptions,
	SpellProvider,
	SuggestRequest,
	SuggestResponse,
} from "./components/rich-text-spellcheck.js";
export {
	openSpellProvider,
	type SpellWorkerPort,
} from "./components/rich-text-spellcheck-provider.js";
export {
	normaliseWord,
	SUGGESTION_LIMIT,
	suggestionsFor,
} from "./components/rich-text-spellcheck-words.js";
export {
	type ComposeCaret,
	EMPTY_RICH_TEXT,
	type RichTextValue,
} from "./components/rich-text-value.js";
export {
	type ComposeLanguageControl,
	type ComposeLanguageSource,
	type ComposeLanguageState,
	useComposeLanguage,
} from "./components/use-compose-language.js";
export {
	DETECTION_MIN_LENGTH,
	detectComposeLanguage,
} from "./lib/detect-compose-language.js";
