/**
 * A list under the triage keyboard: the cursor, the selection and the two
 * props `MessageListPane` draws them from.
 *
 * The app routes the same actions through its own list commands, because its
 * rows are virtualized and its verbs reach the server. Everything else that
 * mounts a list — the kit's stories and the Storybook prototype — drives it
 * from here, so a shift-range, a cmd-toggle and select-all are one behaviour
 * with one definition, and the footer offers exactly the keys that are wired.
 *
 * The layer binds its keys to the pane element rather than the window, so a
 * page carrying several lists gives each of them only the keys pressed inside
 * it. It takes the rows it walks from that same element rather than from the
 * caller's data: a section behind "Show N more", a collapsed header and a
 * category scope all take rows off the screen without touching the data, and a
 * cursor or a count built from the data reaches them anyway.
 */
import { useEffect, useMemo, useState } from "react";
import type {
	MessageListKeyboard,
	MessageListSelection,
} from "../components/app-shell-types.js";
import type { TriageHandlers } from "./keymap.js";
import { type ListCursor, useListCursor } from "./use-list-cursor.js";
import { useRenderedRowIds } from "./use-rendered-row-ids.js";
import { useTriageKeyboard } from "./use-triage-keyboard.js";

const NO_ROWS: string[] = [];

export interface UseListKeyboardOptions {
	isDesktop: boolean;
	/** Seeds the cursor — normally the open thread. */
	initialFocusedId?: string;
	/** Rows ticked on first render. */
	initialSelectedIds?: readonly string[];
	/** Off while something above the list owns the keyboard. */
	enabled?: boolean;
}

export interface ListKeyboard {
	cursor: ListCursor;
	/**
	 * The rows the pane is rendering, in display order — what the keys walk,
	 * what ⌘A takes, and what a select-all checkbox above the list counts.
	 */
	orderedIds: string[];
	/** The pane's `selection` prop. */
	selection: MessageListSelection;
	/** The pane's `keyboard` prop. */
	keyboard: MessageListKeyboard;
}

export const useListKeyboard = ({
	isDesktop,
	initialFocusedId,
	initialSelectedIds,
	enabled = true,
}: UseListKeyboardOptions): ListKeyboard => {
	const [pane, setPane] = useState<HTMLElement | null>(null);
	const renderedIds = useRenderedRowIds(pane);
	const orderedIds = renderedIds ?? NO_ROWS;

	const cursor = useListCursor({
		orderedIds,
		isDesktop,
		initialFocusedId,
		initialSelectedIds,
	});

	const handlers: TriageHandlers = {
		focusNext: cursor.focusNext,
		focusPrevious: cursor.focusPrevious,
		focusFirst: cursor.focusFirst,
		focusLast: cursor.focusLast,
		toggleSelect: cursor.toggleFocusedSelection,
		extendSelectDown: cursor.extendRangeDown,
		extendSelectUp: cursor.extendRangeUp,
		selectAll: cursor.selectAllLoaded,
		back: cursor.exitSelection,
	};
	useTriageKeyboard({ handlers, enabled, target: pane });

	// A row that leaves the screen — a filter, an account pill, a collapsed
	// section, a completed verb — cannot stay selected, or the count and the
	// verbs act on rows nobody can see. The same rule the app runs in
	// `ThreadListInteraction`. Rows that have not been read yet are not rows that
	// left, so the seeded selection survives the first render.
	const { intersectWith } = cursor.selection;
	useEffect(() => {
		if (renderedIds === undefined) return;
		intersectWith(renderedIds);
	}, [intersectWith, renderedIds]);

	const { selectedIds, toggle } = cursor.selection;
	const { handleRowSelect } = cursor;
	const selection = useMemo<MessageListSelection>(
		() => ({
			selectedIds,
			onToggle: toggle,
			onRowSelect: handleRowSelect,
		}),
		[selectedIds, toggle, handleRowSelect],
	);

	return {
		cursor,
		orderedIds,
		selection,
		keyboard: {
			focusedId: cursor.focusedMessageId,
			handlers,
			ref: setPane,
		},
	};
};
