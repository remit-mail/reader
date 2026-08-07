import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { mergeRegister } from "@lexical/utils";
import {
	$getRoot,
	$getSelection,
	$insertNodes,
	$isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	COMMAND_PRIORITY_LOW,
	KEY_DOWN_COMMAND,
	type LexicalEditor,
	PASTE_COMMAND,
} from "lexical";
import { useEffect, useRef } from "react";
import { $adoptHtml, $readRichText } from "./rich-text-document.js";
import { RICH_TEXT_NODES, richTextTheme } from "./rich-text-nodes.js";
import { RichTextToolbar } from "./rich-text-toolbar.js";
import type { RichTextValue } from "./rich-text-value.js";

export interface RichTextEditorProps {
	/**
	 * The document the editor opens on. Read once — reopen a different document
	 * by remounting under a different `key`.
	 */
	initialHtml?: string;
	onChange?: (value: RichTextValue) => void;
	onSubmit?: () => void;
	autoFocus?: boolean;
	placeholder?: string;
	ariaLabel?: string;
}

/**
 * Adopted HTML enters the document as structure, never as characters. Without
 * this, a clipboard whose only markup lives in its text flavour puts the source
 * of a web page into the message (#671).
 *
 * `Shift` on the paste keystroke selects the text flavour, matching Gmail and
 * Apple Mail. The clipboard event carries no modifier state, so the keystroke
 * that triggered it is what records the intent.
 */
const PastePlugin = () => {
	const [editor] = useLexicalComposerContext();
	const plainRequested = useRef(false);

	useEffect(
		() =>
			mergeRegister(
				editor.registerCommand(
					KEY_DOWN_COMMAND,
					(event) => {
						if (
							(event.metaKey || event.ctrlKey) &&
							event.key.toLowerCase() === "v"
						) {
							plainRequested.current = event.shiftKey;
						}
						return false;
					},
					COMMAND_PRIORITY_LOW,
				),
				editor.registerCommand(
					PASTE_COMMAND,
					(event) => {
						// Lexical raises this command for `beforeinput` too, so the
						// modifier is read only once the event carrying the clipboard has
						// arrived — anything else would consume the intent.
						if (!(event instanceof ClipboardEvent)) return false;
						const clipboard = event.clipboardData;
						if (!clipboard) return false;
						const wasPlainRequested = plainRequested.current;
						plainRequested.current = false;

						if (wasPlainRequested) {
							const selection = $getSelection();
							if (!$isRangeSelection(selection)) return false;
							event.preventDefault();
							selection.insertRawText(clipboard.getData("text/plain"));
							return true;
						}

						const html = clipboard.getData("text/html");
						if (!html) return false;

						event.preventDefault();
						$insertNodes($adoptHtml(editor, html));
						return true;
					},
					COMMAND_PRIORITY_CRITICAL,
				),
			),
		[editor],
	);

	return null;
};

/**
 * Reports the document on mount as well as on every edit. What the caller
 * handed in as `initialHtml` is not what the editor holds — it has been through
 * the paste profile and Lexical's own import — so a caller that assumed
 * otherwise would autosave a body the composer is not showing.
 */
const ChangePlugin = ({
	onChange,
}: {
	onChange: (value: RichTextValue) => void;
}) => {
	const [editor] = useLexicalComposerContext();
	const report = useRef(onChange);

	useEffect(() => {
		report.current = onChange;
	}, [onChange]);

	useEffect(() => {
		const emit = () => report.current(editor.read(() => $readRichText(editor)));
		emit();
		return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
			if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
			emit();
		});
	}, [editor]);

	return null;
};

const AutoFocus = ({ enabled }: { enabled: boolean }) => {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		if (!enabled) return;
		const timer = setTimeout(() => editor.focus(), 0);
		return () => clearTimeout(timer);
	}, [editor, enabled]);

	return null;
};

const seedDocument =
	(html: string) =>
	(editor: LexicalEditor): void => {
		const nodes = $adoptHtml(editor, html);
		if (nodes.length === 0) return;
		$getRoot().select();
		$insertNodes(nodes);
	};

export const RichTextEditor = ({
	initialHtml,
	onChange,
	onSubmit,
	autoFocus = false,
	placeholder = "Write your message…",
	ariaLabel = "Message body",
}: RichTextEditorProps) => (
	<LexicalComposer
		initialConfig={{
			namespace: "compose",
			nodes: RICH_TEXT_NODES,
			theme: richTextTheme,
			editorState: initialHtml ? seedDocument(initialHtml) : undefined,
			onError: (error) => {
				throw error;
			},
		}}
	>
		{/* The editable claims the height its container offers rather than only the
		    height of its own text. What is under the last line is the document, so
		    a click there reaches it instead of an unfocusable parent. */}
		<div className="flex shrink-0 grow flex-col">
			<RichTextToolbar />
			<div className="relative flex shrink-0 grow flex-col">
				<RichTextPlugin
					contentEditable={
						<ContentEditable
							aria-label={ariaLabel}
							aria-placeholder={placeholder}
							data-testid="compose-body"
							className="min-h-[120px] w-full shrink-0 grow bg-canvas px-3 py-2 text-sm text-fg outline-none"
							placeholder={
								<div className="pointer-events-none absolute inset-x-0 top-0 px-3 py-2 text-sm text-fg-subtle">
									{placeholder}
								</div>
							}
							onKeyDown={(event) => {
								if (!onSubmit) return;
								if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter")
									return;
								event.preventDefault();
								onSubmit();
							}}
						/>
					}
					ErrorBoundary={LexicalErrorBoundary}
				/>
			</div>
		</div>
		<HistoryPlugin />
		<ListPlugin />
		<LinkPlugin />
		<TablePlugin />
		<PastePlugin />
		<AutoFocus enabled={autoFocus} />
		{onChange && <ChangePlugin onChange={onChange} />}
	</LexicalComposer>
);
