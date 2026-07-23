/**
 * ThreadListInteraction — the keyboard cursor and multi-selection for a list
 * that renders its own rows.
 *
 * `MessageList` (the mailbox) owns a virtualizer and threads this state through
 * row props. The brief and Flagged render rows through the kit's section
 * components, which pass only the thread and its click handler, so the state
 * reaches the row through context instead. Both drive the same `useListCursor`
 * and publish the same `MessageListCommands`, so there is one definition of
 * what j/k, x, shift-arrow and ⌘A do (#149).
 */
import type { ThreadRowData } from "@remit/ui";
import {
	createContext,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useMemo,
} from "react";
import { useListCursor } from "@/hooks/useListCursor";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import type { TriageContextUpdate } from "@/hooks/useTriageLayer";
import type { MessageListCommands } from "./MessageList";
import type { MessageRowSelection } from "./MessageRow";
import { SelectionToolbar } from "./SelectionToolbar";

interface ThreadRowInteraction {
	focused: boolean;
	isTabStop: boolean;
	selection: MessageRowSelection;
	onFocusRow: (messageId: string) => void;
}

interface ThreadListInteractionValue {
	rowInteraction: (messageId: string) => ThreadRowInteraction;
	selectedIds: Set<string>;
	selectedCount: number;
	exitSelection: () => void;
}

const ThreadListInteractionCtx =
	createContext<ThreadListInteractionValue | null>(null);

/**
 * Per-row cursor/selection state, or null outside a provider — the mailbox list
 * passes the same state as explicit row props.
 */
export const useThreadRowInteraction = (
	messageId: string,
): ThreadRowInteraction | null => {
	const ctx = useContext(ThreadListInteractionCtx);
	return ctx ? ctx.rowInteraction(messageId) : null;
};

/** The list's current selection, for a selection toolbar mounted alongside. */
export const useThreadListSelection = (): Pick<
	ThreadListInteractionValue,
	"selectedIds" | "selectedCount" | "exitSelection"
> => {
	const ctx = useContext(ThreadListInteractionCtx);
	if (!ctx) {
		throw new Error(
			"useThreadListSelection must be used inside <ThreadListInteraction>",
		);
	}
	return ctx;
};

interface ThreadListInteractionProps {
	rows: ThreadRowData[];
	selectedMessageId: string | undefined;
	/** Opens a row — the same navigation a click performs. */
	onOpen: (messageId: string) => void;
	/** Deletes a set of messages. Absent disables the delete key for this list. */
	onDeleteMessages?: (messageIds: string[]) => void;
	commandsRef?: RefObject<MessageListCommands | null>;
	onTriageContextChange?: (context: TriageContextUpdate) => void;
	children: ReactNode;
}

export function ThreadListInteraction({
	rows,
	selectedMessageId,
	onOpen,
	onDeleteMessages,
	commandsRef,
	onTriageContextChange,
	children,
}: ThreadListInteractionProps) {
	const isDesktop = useIsDesktop();
	const orderedIds = useMemo(() => rows.map((row) => row.id), [rows]);
	const cursor = useListCursor({
		orderedIds,
		isDesktop,
		initialFocusedId: selectedMessageId,
	});
	const {
		focusedMessageId,
		setFocusedMessageId,
		pendingDomFocusRef,
		cursorMovedByPointerRef,
		selection,
		isMultiSelectMode,
		exitSelection,
		handleRowSelect,
	} = cursor;
	const { selectedIds, selectedCount, isSelected, toggle, select } = selection;

	// Real browser focus follows the cursor, so Tab, Shift+Tab and the focus ring
	// agree with what the list highlights.
	useEffect(() => {
		const pending = pendingDomFocusRef.current;
		if (pending === null) return;
		pendingDomFocusRef.current = null;
		const row = document.querySelector<HTMLElement>(
			`[data-message-id="${pending}"]`,
		);
		row?.focus();
	});

	const handleFocusRow = useCallback(
		(messageId: string) => {
			cursorMovedByPointerRef.current = true;
			setFocusedMessageId(messageId);
		},
		[cursorMovedByPointerRef, setFocusedMessageId],
	);

	const handleLongPress = useCallback(
		(messageId: string) => {
			if (!isDesktop) select(messageId);
		},
		[isDesktop, select],
	);

	const openFocused = useCallback(() => {
		if (focusedMessageId) onOpen(focusedMessageId);
	}, [focusedMessageId, onOpen]);

	const requestDelete = useCallback((): boolean => {
		if (!onDeleteMessages) return false;
		if (selectedCount > 0) {
			onDeleteMessages(Array.from(selectedIds));
			exitSelection();
			return true;
		}
		if (focusedMessageId) {
			onDeleteMessages([focusedMessageId]);
			return true;
		}
		return false;
	}, [
		onDeleteMessages,
		selectedCount,
		selectedIds,
		focusedMessageId,
		exitSelection,
	]);

	const clearSelectionCommand = useCallback((): boolean => {
		if (selectedCount === 0) return false;
		exitSelection();
		return true;
	}, [selectedCount, exitSelection]);

	const hasList = rows.length > 0;

	useEffect(() => {
		if (!commandsRef) return;
		if (!hasList) {
			commandsRef.current = null;
			return;
		}
		commandsRef.current = {
			focusNext: cursor.focusNext,
			focusPrevious: cursor.focusPrevious,
			focusFirst: cursor.focusFirst,
			focusLast: cursor.focusLast,
			openFocused,
			toggleSelect: cursor.toggleFocusedSelection,
			extendSelectDown: cursor.extendRangeDown,
			extendSelectUp: cursor.extendRangeUp,
			selectAll: cursor.selectAllLoaded,
			clearSelection: clearSelectionCommand,
			requestDelete,
			// The brief and Flagged have no density switch; the key stays inert here
			// rather than moving a control these views do not offer.
			toggleDensity: () => undefined,
		};
		return () => {
			commandsRef.current = null;
		};
	}, [
		commandsRef,
		hasList,
		cursor.focusNext,
		cursor.focusPrevious,
		cursor.focusFirst,
		cursor.focusLast,
		cursor.toggleFocusedSelection,
		cursor.extendRangeDown,
		cursor.extendRangeUp,
		cursor.selectAllLoaded,
		openFocused,
		clearSelectionCommand,
		requestDelete,
	]);

	const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);
	useEffect(() => {
		onTriageContextChange?.({
			focusedMessageId,
			selectedIds: selectedIdList,
			orderedIds,
			hasList,
			blocksKeyboard: false,
		});
	}, [
		onTriageContextChange,
		focusedMessageId,
		selectedIdList,
		orderedIds,
		hasList,
	]);

	// The cursor's tab stop: the focused row, or the first row before the
	// keyboard has been used, so Tab enters the list at one place.
	const tabStopId = focusedMessageId ?? orderedIds[0];

	const value = useMemo<ThreadListInteractionValue>(
		() => ({
			selectedIds,
			selectedCount,
			exitSelection,
			rowInteraction: (messageId: string) => ({
				focused: messageId === focusedMessageId,
				isTabStop: messageId === tabStopId,
				onFocusRow: handleFocusRow,
				selection: {
					isChecked: isSelected(messageId),
					onToggleCheck: toggle,
					onRowSelect: handleRowSelect,
					isMultiSelectMode,
					onLongPress: handleLongPress,
				},
			}),
		}),
		[
			selectedIds,
			selectedCount,
			exitSelection,
			focusedMessageId,
			tabStopId,
			handleFocusRow,
			isSelected,
			toggle,
			handleRowSelect,
			isMultiSelectMode,
			handleLongPress,
		],
	);

	return (
		<ThreadListInteractionCtx.Provider value={value}>
			{children}
		</ThreadListInteractionCtx.Provider>
	);
}

interface ThreadListSelectionBarProps {
	onDelete: (messageIds: string[]) => void;
	onMarkAsRead?: (messageIds: string[]) => void;
	isDeleting?: boolean;
}

/**
 * Selection bar for a list inside `ThreadListInteraction`.
 *
 * Move is not offered here: the brief and Flagged span accounts and mailboxes,
 * and a move picker needs one account and one source folder to be honest about
 * where the messages go. Delete and mark-read carry no such scope.
 */
export function ThreadListSelectionBar({
	onDelete,
	onMarkAsRead,
	isDeleting,
}: ThreadListSelectionBarProps) {
	const { selectedIds, selectedCount, exitSelection } =
		useThreadListSelection();

	const handleDelete = useCallback(() => {
		onDelete(Array.from(selectedIds));
		exitSelection();
	}, [onDelete, selectedIds, exitSelection]);

	const handleMarkAsRead = useCallback(() => {
		onMarkAsRead?.(Array.from(selectedIds));
		exitSelection();
	}, [onMarkAsRead, selectedIds, exitSelection]);

	return (
		<SelectionToolbar
			selectedCount={selectedCount}
			onDelete={handleDelete}
			onClearSelection={exitSelection}
			onMarkAsRead={onMarkAsRead ? handleMarkAsRead : undefined}
			isDeleting={isDeleting}
		/>
	);
}
