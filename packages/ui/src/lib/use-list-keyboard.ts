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
 * it.
 *
 * The cursor and the selection hold the rows the pane is rendering, read from
 * the pane itself. A list body narrows further than its consumer can see — the
 * brief's category scope and chips, its ten-row cap, a collapsed section — and
 * the rows behind that narrowing are neither reachable by the keys nor part of
 * what a verb acts on.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	MessageListKeyboard,
	MessageListSelection,
} from "../components/app-shell-types.js";
import type { TriageHandlers } from "./keymap.js";
import { type ListCursor, useListCursor } from "./use-list-cursor.js";
import { useRenderedRowIds } from "./use-rendered-row-ids.js";
import { useTriageKeyboard } from "./use-triage-keyboard.js";

export interface UseListKeyboardOptions {
	/** Row ids in display order, until the pane is up to say what it renders. */
	orderedIds: string[];
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
	/** The rows the pane is rendering, in display order. */
	orderedIds: string[];
	/** The pane's `selection` prop. */
	selection: MessageListSelection;
	/** The pane's `keyboard` prop. */
	keyboard: MessageListKeyboard;
}

export const useListKeyboard = ({
	orderedIds,
	isDesktop,
	initialFocusedId,
	initialSelectedIds,
	enabled = true,
}: UseListKeyboardOptions): ListKeyboard => {
	const [pane, setPane] = useState<HTMLElement | null>(null);
	const renderedIds = useRenderedRowIds(pane);
	const visibleIds = renderedIds ?? orderedIds;

	const cursor = useListCursor({
		orderedIds: visibleIds,
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

	// A row that leaves the list — a filter, a cap, a collapsed section, a
	// completed verb — cannot stay selected, or the count and the verbs act on
	// rows nobody can see. The same rule the app runs in `ThreadListInteraction`.
	const { intersectWith } = cursor.selection;
	useEffect(() => {
		intersectWith(visibleIds);
	}, [intersectWith, visibleIds]);

	// Real focus arriving on a row by any route — a click, Tab, the browser
	// restoring it — brings the cursor with it, so the ring and the row the keys
	// act on are one row.
	const { setFocusedMessageId } = cursor;
	const onFocusRow = useCallback(
		(id: string) => setFocusedMessageId(id),
		[setFocusedMessageId],
	);

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
		orderedIds: visibleIds,
		selection,
		keyboard: {
			focusedId: cursor.focusedMessageId,
			handlers,
			onFocusRow,
			ref: setPane,
		},
	};
};
