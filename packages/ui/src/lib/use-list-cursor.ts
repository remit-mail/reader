/**
 * useListCursor — the roving keyboard cursor and multi-selection of a thread
 * list, independent of how the list renders.
 *
 * The mailbox list, the daily brief and Flagged all need it. It used to exist
 * only inside `MessageList`, so the brief and Flagged had no cursor and no
 * selection at all (#149). Everything here is list-shape agnostic: it works off
 * the ordered message ids, so a virtualized flat list and a sectioned brief
 * drive the same state.
 *
 * DOM concerns stay with the caller. `pendingDomFocusRef` names the row that
 * should take real browser focus once it is rendered, and
 * `cursorMovedByPointerRef` records whether the last move came from a click, so
 * a list that scrolls its cursor into view can skip doing so for pointer moves.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
	deriveIsMultiSelectMode,
	nextFocusId,
	rowSelectIntent,
	type SelectionModifiers,
	useSelection,
} from "./use-selection.js";

interface UseListCursorOptions {
	/** Message ids in display order. */
	orderedIds: string[];
	isDesktop: boolean;
	/** Seeds the cursor — normally the open thread. */
	initialFocusedId?: string;
	/** Rows ticked on first render, for a surface that opens with a selection. */
	initialSelectedIds?: readonly string[];
	/** Extra teardown run before the selection is cleared. */
	onExitSelection?: () => void;
}

export interface ListCursor {
	focusedMessageId: string | undefined;
	setFocusedMessageId: (id: string | undefined) => void;
	/**
	 * The row a keyboard command last moved the cursor onto, and `undefined`
	 * whenever the cursor last moved some other way. Drives the reading pane
	 * following the cursor (`useFollowFocusOpen`) — a click and Enter open on
	 * their own, so only a bare cursor move is left to follow.
	 */
	keyboardFocusedMessageId: string | undefined;
	focusIndex: number;
	pendingDomFocusRef: React.RefObject<string | null>;
	cursorMovedByPointerRef: React.RefObject<boolean>;
	selection: ReturnType<typeof useSelection>;
	isMultiSelectMode: boolean;
	exitSelection: () => void;
	moveFocusToIndex: (index: number) => void;
	focusNext: () => void;
	focusPrevious: () => void;
	focusFirst: () => void;
	focusLast: () => void;
	toggleFocusedSelection: () => void;
	extendRangeUp: () => void;
	extendRangeDown: () => void;
	selectAllLoaded: () => void;
	/**
	 * Desktop mouse selection semantics (Apple Mail / Gmail model). Returns true
	 * when selection handled the click — the caller must then suppress the
	 * row's navigation; false for a plain click.
	 */
	handleRowSelect: (
		messageId: string,
		modifiers: SelectionModifiers,
	) => boolean;
}

export const useListCursor = ({
	orderedIds,
	isDesktop,
	initialFocusedId,
	initialSelectedIds,
	onExitSelection,
}: UseListCursorOptions): ListCursor => {
	// The keyboard "where am I" pointer, distinct from the open thread
	// (the message segment in the path). j/k move this cursor; Enter opens the
	// focused row, and on desktop the reading pane follows the cursor of its own
	// accord (`useFollowFocusOpen`). It seeds from the open thread so opening a
	// message also focuses its row.
	const [focusedMessageId, setFocusedId] = useState<string | undefined>(
		initialFocusedId,
	);

	// Which of those moves came from a keyboard command, so the reading pane can
	// follow the cursor without following a click that already opened its own row.
	const [keyboardFocusedMessageId, setKeyboardFocusedMessageId] = useState<
		string | undefined
	>();

	// Every non-keyboard move — a click, Tab, a thread opening, a refetch snapping
	// the cursor to a survivor — drops the keyboard mark, so nothing follows it.
	// A row taking DOM focus as the *consequence* of a keyboard move arrives here
	// with the id that move just set; keeping the mark in that case is what stops
	// the browser's own focus event from cancelling the load the move started.
	const setFocusedMessageId = useCallback((id: string | undefined) => {
		setKeyboardFocusedMessageId((current) =>
			current === id ? current : undefined,
		);
		setFocusedId(id);
	}, []);

	const selection = useSelection({ initialSelectedIds });
	const {
		selectedCount,
		toggle: toggleCheck,
		clearSelection,
		selectRange,
		setAnchor,
		selectAll,
	} = selection;

	// The selection count is the only source of truth for whether the list is in
	// multi-select mode (#115). A separate flag needs an effect to reconcile it
	// back to the count, and across that render the two disagree.
	const isMultiSelectMode = deriveIsMultiSelectMode(selectedCount, isDesktop);

	// Set when a keyboard command moves the cursor. Real DOM focus then follows
	// it onto the row once rendered, so the browser's own focus — and therefore
	// Tab, Shift+Tab and the focus ring — agree with what the list highlights
	// (#43).
	const pendingDomFocusRef = useRef<string | null>(null);
	// Whether the cursor's last move came from a row taking DOM focus (a click)
	// rather than a command. Scrolling for a click moves the row out from under
	// the pointer between mousedown and click, so the click lands on empty space
	// and nothing opens (#85).
	const cursorMovedByPointerRef = useRef(false);

	const exitSelection = useCallback(() => {
		onExitSelection?.();
		clearSelection();
	}, [clearSelection, onExitSelection]);

	const focusIndex = useMemo(
		() => (focusedMessageId ? orderedIds.indexOf(focusedMessageId) : -1),
		[orderedIds, focusedMessageId],
	);

	// Move the cursor by index. In multi-select mode (mobile) j/k toggle
	// selection rather than moving a cursor.
	const moveFocusToIndex = useCallback(
		(index: number) => {
			if (index < 0 || index >= orderedIds.length) return;
			const messageId = orderedIds[index];
			if (isMultiSelectMode) {
				toggleCheck(messageId);
				return;
			}
			pendingDomFocusRef.current = messageId;
			cursorMovedByPointerRef.current = false;
			setKeyboardFocusedMessageId(messageId);
			setFocusedId(messageId);
		},
		[orderedIds, isMultiSelectMode, toggleCheck],
	);

	const focusNext = useCallback(() => {
		if (orderedIds.length === 0) return;
		moveFocusToIndex(
			focusIndex < 0 ? 0 : Math.min(focusIndex + 1, orderedIds.length - 1),
		);
	}, [orderedIds.length, focusIndex, moveFocusToIndex]);

	const focusPrevious = useCallback(() => {
		if (orderedIds.length === 0) return;
		moveFocusToIndex(focusIndex <= 0 ? 0 : focusIndex - 1);
	}, [orderedIds.length, focusIndex, moveFocusToIndex]);

	const focusFirst = useCallback(() => moveFocusToIndex(0), [moveFocusToIndex]);
	const focusLast = useCallback(
		() => moveFocusToIndex(orderedIds.length - 1),
		[moveFocusToIndex, orderedIds.length],
	);

	const toggleFocusedSelection = useCallback(() => {
		if (focusedMessageId) toggleCheck(focusedMessageId);
	}, [focusedMessageId, toggleCheck]);

	const handleRowSelect = useCallback(
		(messageId: string, modifiers: SelectionModifiers): boolean => {
			const intent = rowSelectIntent(modifiers);
			if (intent === "range") {
				// The open/focused row is the fallback origin when the stored anchor
				// has been filtered or searched out of the visible list, so the first
				// shift-click still ranges from where the user is (#142, #144).
				selectRange(orderedIds, messageId, focusedMessageId);
				return true;
			}
			if (intent === "toggle") {
				toggleCheck(messageId);
				return true;
			}
			// Plain click: collapse any multi-selection and let navigation proceed.
			// The clicked row becomes the next anchor for a subsequent shift-click,
			// but is NOT added to the checkbox set (no toolbar on a plain open).
			exitSelection();
			setAnchor(messageId);
			return false;
		},
		[
			orderedIds,
			focusedMessageId,
			selectRange,
			toggleCheck,
			exitSelection,
			setAnchor,
		],
	);

	// Shift+arrow moves the cursor one row and adds the row it lands on to the
	// range — the keyboard equivalent of shift-click. The first press seeds the
	// anchor on that row; consecutive presses extend from it. The range only
	// grows, so reversing direction ranges back through the anchor rather than
	// giving rows up.
	const extendRange = useCallback(
		(direction: -1 | 1) => {
			const target = nextFocusId(orderedIds, focusedMessageId, direction);
			if (target === undefined) return;
			selectRange(orderedIds, target);
			pendingDomFocusRef.current = target;
			cursorMovedByPointerRef.current = false;
			// Shift+arrow is building a range, not reading. The reading pane stays on
			// whatever is open rather than chasing the growing edge of the selection.
			setKeyboardFocusedMessageId(undefined);
			setFocusedId(target);
		},
		[orderedIds, focusedMessageId, selectRange],
	);

	const extendRangeUp = useCallback(() => extendRange(-1), [extendRange]);
	const extendRangeDown = useCallback(() => extendRange(1), [extendRange]);

	const selectAllLoaded = useCallback(() => {
		if (orderedIds.length > 0) selectAll(orderedIds);
	}, [orderedIds, selectAll]);

	return {
		focusedMessageId,
		setFocusedMessageId,
		keyboardFocusedMessageId,
		focusIndex,
		pendingDomFocusRef,
		cursorMovedByPointerRef,
		selection,
		isMultiSelectMode,
		exitSelection,
		moveFocusToIndex,
		focusNext,
		focusPrevious,
		focusFirst,
		focusLast,
		toggleFocusedSelection,
		extendRangeUp,
		extendRangeDown,
		selectAllLoaded,
		handleRowSelect,
	};
};
