import {
	type ClipboardEvent,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Banner } from "./banner.js";
import { htmlToMarkdown } from "./rich-text-document.js";

export interface PlainTextEditorProps {
	value: string;
	onChange: (text: string) => void;
	onSubmit?: () => void;
	/** Takes focus on mount, caret after the last character. */
	autoFocus?: boolean;
	placeholder?: string;
	ariaLabel?: string;
	/** Pinned to the right of the toolbar strip. The mode toggle rides here. */
	trailing?: ReactNode;
	/**
	 * BCP 47 tag of the language the message is being written in. Firefox picks
	 * a dictionary from it among the ones the user installed; Chrome and Safari
	 * ignore it. Every screen reader picks a voice from it.
	 */
	lang?: string;
}

const EMPTY_PASTE_NOTICE =
	"Nothing to paste. The copied content was an image, or had no text in it.";

/**
 * Insert through the platform where it is available, so the textarea's own undo
 * stack survives the paste — `Ctrl+Z` is the browser's here, and a value
 * replaced from script is not something it can undo. jsdom has no
 * `execCommand`, so the same insertion is spliced by hand there.
 */
const insertAtCaret = (
	textarea: HTMLTextAreaElement,
	text: string,
): { value: string; caret: number } | null => {
	const start = textarea.selectionStart ?? textarea.value.length;
	const end = textarea.selectionEnd ?? start;
	const execCommand = document.execCommand?.bind(document);
	if (execCommand?.("insertText", false, text)) return null;
	return {
		value: textarea.value.slice(0, start) + text + textarea.value.slice(end),
		caret: start + text.length,
	};
};

/**
 * The plain writing surface. A textarea, not a configuration of the rich
 * editor: it shows the exact characters that will be sent and gets the
 * platform's keyboard, IME, autocorrect, spellcheck and selection for free.
 */
export const PlainTextEditor = ({
	value,
	onChange,
	onSubmit,
	autoFocus = false,
	placeholder = "Write your message…",
	ariaLabel = "Message body",
	trailing,
	lang,
}: PlainTextEditorProps) => {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const pendingCaret = useRef<number | null>(null);
	const plainRequested = useRef(false);
	const [emptyPaste, setEmptyPaste] = useState(false);

	// Grows to its content rather than scrolling inside itself: one scroller in
	// the compose body keeps the caret in view for free, which a nested one is
	// fragile about with the iOS keyboard up.
	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
		if (textarea.value !== value) return;
		const caret = pendingCaret.current;
		if (caret === null) return;
		pendingCaret.current = null;
		textarea.setSelectionRange(caret, caret);
	}, [value]);

	useEffect(() => {
		if (!autoFocus) return;
		const textarea = textareaRef.current;
		if (!textarea) return;
		const timer = setTimeout(() => {
			textarea.focus();
			const end = textarea.value.length;
			textarea.setSelectionRange(end, end);
		}, 0);
		return () => clearTimeout(timer);
	}, [autoFocus]);

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		// `Shift` on the paste keystroke selects the text flavour, matching Gmail
		// and Apple Mail. A clipboard event carries no modifier state, so the
		// keystroke that triggered it is what records the intent — and every
		// Ctrl+V restates it, so an intent nothing acted on does not survive to
		// the next paste.
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
			plainRequested.current = event.shiftKey;
		}
		if (!onSubmit) return;
		if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
		event.preventDefault();
		onSubmit();
	};

	const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const clipboard = event.clipboardData;
		if (!clipboard) return;
		const textarea = event.currentTarget;
		event.preventDefault();

		const wasPlainRequested = plainRequested.current;
		plainRequested.current = false;

		const text = clipboard.getData("text/plain");
		const html = wasPlainRequested ? "" : clipboard.getData("text/html");
		const inserted = (html ? htmlToMarkdown(html) : "") || text;

		if (inserted === "") {
			setEmptyPaste(true);
			return;
		}
		setEmptyPaste(false);

		const spliced = insertAtCaret(textarea, inserted);
		if (!spliced) return;
		pendingCaret.current = spliced.caret;
		onChange(spliced.value);
	};

	return (
		<div className="flex shrink-0 grow flex-col">
			<div className="sticky top-0 z-10 border-b border-line bg-canvas">
				<div className="flex items-center gap-2 px-3 py-1">
					{/* `aria-pressed` on the toggle conveys the mode, not the fact that
					    Markdown syntax is read here, so this line is the only way either
					    a screen reader or someone who typed `## ` learns it. */}
					<span className="min-w-0 truncate py-2 text-xs text-fg-muted">
						Plain text · Markdown
					</span>
					{trailing && (
						<div className="ml-auto flex shrink-0 items-center gap-1">
							{trailing}
						</div>
					)}
				</div>
			</div>
			{emptyPaste && (
				<Banner
					tone="info"
					variant="soft"
					onDismiss={() => setEmptyPaste(false)}
					className="mx-3 mt-2"
				>
					{EMPTY_PASTE_NOTICE}
				</Banner>
			)}
			{/* 16px, not the editor's `text-sm`: iOS Safari zooms the viewport when a
			    form control under 16px takes focus and never zooms back, and
			    contenteditable is exempt — so `text-sm` would be a regression
			    exclusive to plain mode. Monospace with no soft wrap, because a pipe
			    table in a proportional face that breaks mid-row reads as the broken
			    output this mode exists to avoid. */}
			<textarea
				ref={textareaRef}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
				onPaste={handlePaste}
				lang={lang}
				aria-label={ariaLabel}
				placeholder={placeholder}
				data-testid="compose-body-plain"
				wrap="off"
				spellCheck
				className="w-full shrink-0 grow resize-none overflow-x-auto whitespace-pre bg-canvas px-3 py-2 font-mono text-base text-fg outline-none placeholder:text-fg-subtle"
			/>
		</div>
	);
};
