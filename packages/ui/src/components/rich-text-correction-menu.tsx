import { BookPlus, EyeOff } from "lucide-react";
import { useEffect, useRef } from "react";
import { DESKTOP_MEDIA_QUERY } from "../lib/layout-breakpoints.js";
import { useRovingFocus } from "../lib/roving-focus.js";
import { useMatchMedia } from "../lib/use-match-media.js";
import { BottomSheet } from "./bottom-sheet.js";
import {
	type PopoverMenuAnchor,
	PopoverMenuPanel,
	PopoverMenuPortal,
	PopoverMenuRow,
} from "./popover-menu.js";

const SKELETON_WIDTHS = ["w-28", "w-20", "w-24"];

export type CorrectionMenuAnchor = PopoverMenuAnchor;

export interface RichTextCorrectionMenuProps {
	word: string;
	/** Null while the checker is still answering. */
	suggestions: readonly string[] | null;
	/** What the checker said when it could not answer. */
	failure: string | null;
	anchor: CorrectionMenuAnchor;
	language: string;
	onReplace: (suggestion: string) => void;
	onIgnore: () => void;
	/** Rendered only when the mount carries somewhere to put the word. */
	onAddWord?: () => void;
	/**
	 * `returnFocus` is false when the writer's own click is already on its way
	 * somewhere else, and taking the caret back would fight it.
	 */
	onDismiss: (returnFocus: boolean) => void;
}

const CorrectionRows = ({
	word,
	suggestions,
	failure,
	language,
	onReplace,
	onIgnore,
	onAddWord,
}: Omit<RichTextCorrectionMenuProps, "anchor" | "onDismiss">) => (
	<>
		<p
			lang={language}
			data-testid="spell-word"
			className="px-4 pb-1 pt-1.5 text-xs font-medium text-fg-subtle"
		>
			{word}
		</p>
		{suggestions === null && failure === null
			? SKELETON_WIDTHS.map((width) => (
					<div
						key={width}
						aria-hidden="true"
						data-testid="spell-suggestion-skeleton"
						className="flex min-h-11 items-center px-4 py-2.5"
					>
						<span
							className={`h-3 animate-pulse rounded bg-surface-sunken ${width}`}
						/>
					</div>
				))
			: null}
		{failure !== null && (
			<p
				role="alert"
				data-testid="spell-suggestions-failed"
				className="px-4 py-2 text-sm text-danger"
			>
				No suggestions came back: {failure}
			</p>
		)}
		{suggestions?.length === 0 && (
			<p
				data-testid="spell-no-suggestions"
				className="px-4 py-2 text-sm text-fg-muted"
			>
				No suggestions for this word.
			</p>
		)}
		{suggestions?.map((suggestion) => (
			<PopoverMenuRow
				key={suggestion}
				label={suggestion}
				lang={language}
				data-testid="spell-suggestion"
				className="font-medium"
				onSelect={() => onReplace(suggestion)}
			/>
		))}
		<hr className="my-1 border-line" />
		<PopoverMenuRow
			label="Ignore for now"
			icon={<EyeOff className="size-4" />}
			data-testid="spell-ignore"
			onSelect={onIgnore}
		/>
		{onAddWord && (
			<PopoverMenuRow
				label="Add to dictionary"
				icon={<BookPlus className="size-4" />}
				data-testid="spell-add-word"
				onSelect={onAddWord}
			/>
		)}
	</>
);

/**
 * The corrections offered for one misspelt word. The menu is up before the
 * checker has answered — skeleton rows stand where the suggestions will be —
 * and it never goes quiet: a request that failed says so where the suggestions
 * would have been, and ignoring the word stays reachable either way.
 *
 * Below the desktop gate the same rows are a sheet, because a popover anchored
 * to a word sits under the thumb that opened it.
 */
export const RichTextCorrectionMenu = ({
	anchor,
	onDismiss,
	...rows
}: RichTextCorrectionMenuProps) => {
	const desktop = useMatchMedia(DESKTOP_MEDIA_QUERY);
	const panelRef = useRef<HTMLDivElement>(null);

	useRovingFocus({ containerRef: panelRef, itemSelector: '[role="menuitem"]' });

	// The menu takes focus as it opens, so Escape and the arrow keys have
	// somewhere to land rather than staying behind in the message.
	useEffect(() => {
		panelRef.current?.focus();
	}, []);

	// A press rather than a click, and a pointer press rather than a mouse one:
	// the tap that opened this menu is followed by the browser's compatibility
	// mouse events, which a `mousedown` listener reads as a press somewhere else
	// and closes the menu on the way up.
	useEffect(() => {
		if (!desktop) return;
		const onPointer = (event: Event) => {
			if (panelRef.current?.contains(event.target as Node)) return;
			onDismiss(false);
		};
		document.addEventListener("pointerdown", onPointer);
		return () => document.removeEventListener("pointerdown", onPointer);
	}, [desktop, onDismiss]);

	/**
	 * Escape closes it, and so does Tab: a menu is not a dialog, and the repo
	 * traps focus nowhere. Letting Tab walk on would put the caret behind an
	 * open sheet, so the menu goes first and the message has the focus back
	 * before the next stop.
	 */
	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Escape" && event.key !== "Tab") return;
		event.preventDefault();
		event.stopPropagation();
		onDismiss(true);
	};

	if (!desktop) {
		return (
			<BottomSheet
				open
				onClose={() => onDismiss(true)}
				dismissLabel="Close corrections"
			>
				<div
					ref={panelRef}
					role="menu"
					aria-label={`Corrections for ${rows.word}`}
					tabIndex={-1}
					onKeyDown={onKeyDown}
					data-testid="spell-menu"
					className="flex flex-col overflow-y-auto pb-4 outline-none"
				>
					<CorrectionRows {...rows} />
				</div>
			</BottomSheet>
		);
	}

	return (
		<PopoverMenuPortal
			open
			align="start"
			panelRef={panelRef}
			getAnchor={() => anchor}
		>
			<PopoverMenuPanel
				ref={panelRef}
				label={`Corrections for ${rows.word}`}
				onKeyDown={onKeyDown}
				data-testid="spell-menu"
				className="max-w-64"
			>
				<CorrectionRows {...rows} />
			</PopoverMenuPanel>
		</PopoverMenuPortal>
	);
};
