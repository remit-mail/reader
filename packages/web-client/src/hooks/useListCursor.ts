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
	nextFocusId,
	type SelectionModifiers,
	useSelection,
} from "@/hooks/useSelection";
import { deriveIsMultiSelectMode } from "@/lib/selection-mode";

interface UseListCursorOptions {
	/** Message ids in display order. */
	orderedIds: string[];
	isDesktop: boolean;
	/** Seeds the cursor — normally the open thread. */
	initialFocusedId?: string;
	/** Extra teardown run before the selection is cleared. */
	onExitSelection?: () => void;
}

export interface ListCursor {
	focusedMessageId: string | undefined;
	setFocusedMessageId: (id: string | undefined) => void;
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
	onExitSelection,
}: UseListCursorOptions): ListCursor => {
	// The keyboard "where am I" pointer, distinct from the open thread
	// (`selectedMessageId` in the URL). j/k move this cursor without opening;
	// Enter opens the focused row. It seeds from the open thread so opening a
	// message also focuses its row.
	const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>(
		initialFocusedId,
	);

	const selection = useSelection();
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
			setFocusedMessageId(messageId);
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
			if (modifiers.shiftKey) {
				// The open/focused row is the fallback origin when the stored anchor
				// has been filtered or searched out of the visible list, so the first
				// shift-click still ranges from where the user is (#142, #144).
				selectRange(orderedIds, messageId, focusedMessageId);
				return true;
			}
			if (modifiers.metaKey || modifiers.ctrlKey) {
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

	// Shift+arrow moves the cursor one row and extends the range from the
	// existing anchor — the keyboard equivalent of shift-click. The anchor stays
	// fixed across consecutive presses, so moving back toward it shrinks the
	// range.
	const extendRange = useCallback(
		(direction: -1 | 1) => {
			const target = nextFocusId(orderedIds, focusedMessageId, direction);
			if (target === undefined) return;
			selectRange(orderedIds, target);
			pendingDomFocusRef.current = target;
			cursorMovedByPointerRef.current = false;
			setFocusedMessageId(target);
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
