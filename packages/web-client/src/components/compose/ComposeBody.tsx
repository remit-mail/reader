import {
	type ComposeBodyMode,
	ComposeLanguageChip,
	ComposeModeToggle,
	markdownToHtml,
	PlainTextEditor,
	RichTextEditor,
	type RichTextValue,
	useComposeLanguage,
} from "@remit/ui/rich-text";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { conversionOutcome, switchNeedsWarning } from "./compose-mode";

export interface ConversionFailure {
	title: string;
	detail: string;
}

/**
 * The two directions of the mode switch, injectable so a story can drive the
 * conversion that comes back empty — the branch that keeps autosave from
 * persisting a blanked draft, and the one case no real document produces on
 * demand.
 */
export interface ComposeConversions {
	toPlain: (value: RichTextValue) => string;
	toRich: (text: string) => string;
}

export const DEFAULT_COMPOSE_CONVERSIONS: ComposeConversions = {
	toPlain: (value) => value.text,
	toRich: (text) => markdownToHtml(text),
};

const textOf = (html: string): string =>
	new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";

const plainValue = (text: string): RichTextValue => ({
	html: "",
	text,
	formatting: [],
});

interface ComposeBodyProps {
	mode: ComposeBodyMode;
	onModeChange: (mode: ComposeBodyMode) => void;
	initialHtml: string;
	initialText: string;
	onChange: (value: RichTextValue) => void;
	onSubmit?: () => void;
	autoFocus?: boolean;
	onConversionError: (failure: ConversionFailure) => void;
	conversions?: ComposeConversions;
	/** The account's writing languages, most-used first. */
	languages: readonly string[];
	/** The tag a reopened draft was stored under. */
	initialLanguage?: string;
	/** Reports the language the message is being written in, so the form can tag it. */
	onLanguageChange: (language: string) => void;
}

/**
 * The compose writing surface and the control that swaps it. Rich text is the
 * WYSIWYG document; plain text is a textarea whose content is the Markdown that
 * will be sent verbatim. The conversion runs over an in-memory document, so the
 * surface swaps in the same frame the choice is made.
 */
export const ComposeBody = ({
	mode,
	onModeChange,
	initialHtml,
	initialText,
	onChange,
	onSubmit,
	autoFocus = false,
	onConversionError,
	conversions = DEFAULT_COMPOSE_CONVERSIONS,
	languages,
	initialLanguage,
	onLanguageChange,
}: ComposeBodyProps) => {
	const [richHtml, setRichHtml] = useState(initialHtml);
	const [richGeneration, setRichGeneration] = useState(0);
	const [plainText, setPlainText] = useState(initialText);
	const [bodyText, setBodyText] = useState(initialText);
	const [confirming, setConfirming] = useState(false);
	// The caret does not survive a conversion: a rich selection is a node path
	// and Markdown is a character offset. The surface that arrives takes focus
	// with the caret at the end; the toggle keeps it when the mode did not change.
	const [focusSwitchedSurface, setFocusSwitchedSurface] = useState(false);
	const richValue = useRef<RichTextValue>({
		html: initialHtml,
		text: initialText,
		formatting: [],
	});

	// Detection reads the body the user typed. The quoted reply block is not part
	// of it — that lives outside the editor, in the form's own `quoted` slot.
	const { language, choose } = useComposeLanguage({
		languages,
		text: bodyText,
		initialLanguage,
	});

	useEffect(() => {
		onLanguageChange(language);
	}, [language, onLanguageChange]);

	const handleRichChange = (value: RichTextValue) => {
		richValue.current = value;
		setBodyText(value.text);
		onChange(value);
	};

	const handlePlainChange = (text: string) => {
		setPlainText(text);
		setBodyText(text);
		onChange(plainValue(text));
	};

	const switchToPlain = () => {
		const value = richValue.current;
		const converted = conversions.toPlain(value);
		const decision = conversionOutcome("plain", textOf(value.html), converted);
		if (decision.outcome === "blocked") {
			onConversionError(decision);
			return;
		}
		setPlainText(converted);
		setBodyText(converted);
		setFocusSwitchedSurface(true);
		onChange(plainValue(converted));
		onModeChange("plain");
	};

	const switchToRich = () => {
		const converted = conversions.toRich(plainText);
		const decision = conversionOutcome("rich", plainText, textOf(converted));
		if (decision.outcome === "blocked") {
			onConversionError(decision);
			return;
		}
		setRichHtml(converted);
		setRichGeneration((generation) => generation + 1);
		setFocusSwitchedSurface(true);
		onModeChange("rich");
	};

	const handleToggle = () => {
		if (mode === "plain") {
			switchToRich();
			return;
		}
		if (switchNeedsWarning("plain", richValue.current.formatting)) {
			setConfirming(true);
			return;
		}
		switchToPlain();
	};

	// The chip comes first so the mode toggle stays one Shift+Tab out of the
	// body, where #673 put it, and the chip is the second.
	const trailing = (
		<>
			<ComposeLanguageChip
				language={language}
				languages={languages}
				onSelect={choose}
			/>
			<ComposeModeToggle mode={mode} onToggle={handleToggle} />
		</>
	);

	return (
		<>
			{mode === "plain" ? (
				<PlainTextEditor
					value={plainText}
					onChange={handlePlainChange}
					onSubmit={onSubmit}
					autoFocus={focusSwitchedSurface}
					lang={language}
					trailing={trailing}
				/>
			) : (
				<RichTextEditor
					key={richGeneration}
					initialHtml={richHtml}
					onChange={handleRichChange}
					onSubmit={onSubmit}
					autoFocus={autoFocus || focusSwitchedSurface}
					lang={language}
					trailing={trailing}
				/>
			)}
			<ConfirmDialog
				isOpen={confirming}
				title="Switch to plain text?"
				description="Formatting becomes Markdown. Bold keeps its asterisks, a table becomes rows of pipes, and that text is what the recipient gets. No formatted version is sent alongside it."
				confirmLabel="Switch to plain text"
				onConfirm={() => {
					setConfirming(false);
					switchToPlain();
				}}
				onCancel={() => setConfirming(false)}
			/>
		</>
	);
};
