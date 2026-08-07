import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createQuoteNode, $isQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
	$createParagraphNode,
	$getSelection,
	$isRangeSelection,
	CAN_REDO_COMMAND,
	CAN_UNDO_COMMAND,
	COMMAND_PRIORITY_LOW,
	FORMAT_TEXT_COMMAND,
	REDO_COMMAND,
	SELECTION_CHANGE_COMMAND,
	UNDO_COMMAND,
} from "lexical";
import { Bold, Italic, Link, Quote, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const ToolbarButton = ({
	isActive,
	onClick,
	children,
	title,
}: {
	isActive: boolean;
	onClick: () => void;
	children: React.ReactNode;
	title: string;
}) => (
	<button
		type="button"
		onMouseDown={(e) => {
			e.preventDefault();
			onClick();
		}}
		title={title}
		aria-label={title}
		aria-pressed={isActive}
		className={`p-1.5 rounded transition-colors ${
			isActive
				? "text-fg bg-accent-2-soft"
				: "text-fg-muted hover:text-fg hover:bg-surface-raised"
		}`}
	>
		{children}
	</button>
);

interface ToolbarState {
	bold: boolean;
	italic: boolean;
	quote: boolean;
	link: string | null;
	canUndo: boolean;
	canRedo: boolean;
}

const INITIAL_STATE: ToolbarState = {
	bold: false,
	italic: false,
	quote: false,
	link: null,
	canUndo: false,
	canRedo: false,
};

export const RichTextToolbar = () => {
	const [editor] = useLexicalComposerContext();
	const [state, setState] = useState<ToolbarState>(INITIAL_STATE);
	const [linkDraft, setLinkDraft] = useState<string | null>(null);
	const linkInput = useRef<HTMLInputElement>(null);

	const readSelection = useCallback(() => {
		const selection = $getSelection();
		if (!$isRangeSelection(selection)) return;
		const anchor = selection.anchor.getNode();
		const link = $findMatchingParent(anchor, $isLinkNode);
		const quote = $findMatchingParent(anchor, $isQuoteNode);
		setState((previous) => ({
			...previous,
			bold: selection.hasFormat("bold"),
			italic: selection.hasFormat("italic"),
			quote: quote !== null,
			link: $isLinkNode(link) ? link.getURL() : null,
		}));
	}, []);

	useEffect(
		() =>
			mergeRegister(
				editor.registerUpdateListener(({ editorState }) => {
					editorState.read(readSelection);
				}),
				editor.registerCommand(
					SELECTION_CHANGE_COMMAND,
					() => {
						readSelection();
						return false;
					},
					COMMAND_PRIORITY_LOW,
				),
				editor.registerCommand(
					CAN_UNDO_COMMAND,
					(canUndo) => {
						setState((previous) => ({ ...previous, canUndo }));
						return false;
					},
					COMMAND_PRIORITY_LOW,
				),
				editor.registerCommand(
					CAN_REDO_COMMAND,
					(canRedo) => {
						setState((previous) => ({ ...previous, canRedo }));
						return false;
					},
					COMMAND_PRIORITY_LOW,
				),
			),
		[editor, readSelection],
	);

	useEffect(() => {
		if (linkDraft !== null) linkInput.current?.focus();
	}, [linkDraft]);

	const toggleQuote = () => {
		editor.update(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection)) return;
			$setBlocksType(selection, () =>
				state.quote ? $createParagraphNode() : $createQuoteNode(),
			);
		});
	};

	const applyLink = (url: string) => {
		const trimmed = url.trim();
		editor.dispatchCommand(
			TOGGLE_LINK_COMMAND,
			trimmed === "" ? null : trimmed,
		);
		setLinkDraft(null);
		editor.focus();
	};

	return (
		<div className="border-b border-line">
			<div className="flex items-center gap-0.5 px-3 py-1">
				<ToolbarButton
					isActive={state.bold}
					onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
					title="Bold (Ctrl+B)"
				>
					<Bold className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					isActive={state.italic}
					onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
					title="Italic (Ctrl+I)"
				>
					<Italic className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					isActive={state.link !== null}
					onClick={() => setLinkDraft(state.link ?? "https://")}
					title="Link (Ctrl+K)"
				>
					<Link className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					isActive={state.quote}
					onClick={toggleQuote}
					title="Blockquote"
				>
					<Quote className="size-4" />
				</ToolbarButton>
				<div className="mx-1.5 h-4 w-px bg-line" />
				<ToolbarButton
					isActive={false}
					onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
					title="Undo (Ctrl+Z)"
				>
					<Undo2 className={`size-4 ${state.canUndo ? "" : "opacity-40"}`} />
				</ToolbarButton>
				<ToolbarButton
					isActive={false}
					onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
					title="Redo (Ctrl+Y)"
				>
					<Redo2 className={`size-4 ${state.canRedo ? "" : "opacity-40"}`} />
				</ToolbarButton>
			</div>
			{linkDraft !== null && (
				<div className="flex items-center gap-2 border-t border-line px-3 py-1.5">
					<input
						ref={linkInput}
						type="url"
						value={linkDraft}
						aria-label="Link address"
						placeholder="https://example.com"
						className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
						onChange={(e) => setLinkDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								applyLink(linkDraft);
							}
							if (e.key === "Escape") {
								e.preventDefault();
								setLinkDraft(null);
								editor.focus();
							}
						}}
					/>
					<button
						type="button"
						className="text-xs text-accent hover:underline"
						onClick={() => applyLink(linkDraft)}
					>
						Apply
					</button>
					{state.link !== null && (
						<button
							type="button"
							className="text-xs text-fg-muted hover:text-fg"
							onClick={() => applyLink("")}
						>
							Remove
						</button>
					)}
				</div>
			)}
		</div>
	);
};
