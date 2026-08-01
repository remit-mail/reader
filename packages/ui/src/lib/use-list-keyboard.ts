/**
 * A list under the triage keyboard: the cursor, the selection and the two
 * props `MessageListPane` draws them from.
 *
 * The app routes the same actions through its own list commands, because its
 * rows are virtualized and its verbs reach the server. Everything else that
 * mounts a list — the kit's stories and the Storybook prototype — drives it
 * from here, so a shift-range, a cmd-toggle and select-all are one behaviour
 * with one definition, and the footer offers exactly the keys that are wired.
 */
import { useMemo } from "react";
import type {
	MessageListKeyboard,
	MessageListSelection,
} from "../components/app-shell-types.js";
import { keyboardHintsFor, type TriageHandlers } from "./keymap.js";
import { type ListCursor, useListCursor } from "./use-list-cursor.js";
import { useTriageKeyboard } from "./use-triage-keyboard.js";

export interface UseListKeyboardOptions {
	/** Row ids in display order. */
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
	useTriageKeyboard({ handlers, enabled });

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
		selection,
		keyboard: {
			focusedId: cursor.focusedMessageId,
			hints: keyboardHintsFor(handlers),
		},
	};
};
