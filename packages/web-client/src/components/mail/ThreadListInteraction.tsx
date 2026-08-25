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
 *
 * The cursor walks the rows that are actually on screen, read from the DOM. The
 * brief's sections cap themselves at ten rows behind "Show N more", apply their
 * own attribute chips, and collapse from their headers — none of which the data
 * the consumer passed describes. A cursor walking that data steps onto rows that
 * are not rendered: focus stops moving, the highlight disappears, and the next
 * verb acts on a message the user cannot see.
 */
import {
	SelectionTopBar,
	type ThreadRowData,
	useListCursor,
	type Verb,
} from "@remit/ui";
import {
	createContext,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { useDeleteOutcome } from "@/hooks/useDeleteOutcome";
import { useFollowFocusOpen } from "@/hooks/useFollowFocusOpen";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import type { TriageContextUpdate } from "@/hooks/useTriageLayer";
import type { DeleteTarget } from "@/lib/format";
import { tabStopId } from "@/lib/list-focus";
import { useListHeaderChrome } from "@/lib/list-header-chrome";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import type { MessageListCommands } from "./MessageList";
import type { MessageRowSelection } from "./MessageRow";

/** Nothing pending, as a stable identity so the outcome memo does not churn. */
const NO_TARGETS: readonly DeleteTarget[] = [];

interface PendingDelete {
	ids: string[];
	/** Where those rows were filed when the delete was asked for. */
	targets: DeleteTarget[];
}

interface ThreadRowInteraction {
	focused: boolean;
	isTabStop: boolean;
	isDesktop: boolean;
	selection: MessageRowSelection;
	onFocusRow: (messageId: string) => void;
}

interface ThreadListInteractionValue {
	rowInteraction: (messageId: string) => ThreadRowInteraction;
	selectedIds: Set<string>;
	selectedCount: number;
	exitSelection: () => void;
	/**
	 * Runs a verb over the current selection by opening the wizard on it — the
	 * one route every selection action takes, whether the bar or the keyboard
	 * asked for it.
	 */
	startSelectionVerb: (verb: Verb) => void;
	/** Rendered rows in display order — the same order a shift-range spans. */
	orderedIds: string[];
	/** Whether every rendered row is selected, for a select-all control. */
	allSelected: boolean;
	/** Select every rendered row, or clear when they already all are. */
	toggleAllLoaded: () => void;
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
export const useThreadListSelection = (): Omit<
	ThreadListInteractionValue,
	"rowInteraction"
> => {
	const ctx = useContext(ThreadListInteractionCtx);
	if (!ctx) {
		throw new Error(
			"useThreadListSelection must be used inside <ThreadListInteraction>",
		);
	}
	return ctx;
};

const ROW_SELECTOR = "[data-message-id]";

const readRowIds = (container: HTMLElement): string[] =>
	Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR))
		.map((row) => row.dataset.messageId)
		.filter((id): id is string => id !== undefined);

const sameIds = (a: string[], b: string[]): boolean =>
	a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The ids of the rows currently in the DOM, in document order, kept in step
 * with the rendered list. Sections expand, collapse and cap themselves without
 * the consumer's data changing, so a render pass is not enough of a signal — a
 * MutationObserver is.
 */
const useRenderedRowIds = (
	containerRef: RefObject<HTMLElement | null>,
): string[] => {
	const [rowIds, setRowIds] = useState<string[]>([]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const sync = () => {
			const next = readRowIds(container);
			setRowIds((prev) => (sameIds(prev, next) ? prev : next));
		};

		sync();
		const observer = new MutationObserver(sync);
		observer.observe(container, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [containerRef]);

	return rowIds;
};

/**
 * How a row was opened. `replace: true` marks a reading-pane preview the cursor
 * produced rather than a navigation the user asked for, so Back still leaves the
 * list instead of walking the cursor's path back up it.
 */
export interface OpenMessageOptions {
	replace?: boolean;
}

interface ThreadListInteractionProps {
	selectedMessageId: string | undefined;
	/**
	 * The rows this list is showing. Read only to name the folder a row is
	 * filed in, which is what decides whether deleting it moves it to Trash or
	 * expunges it — this list spans mailboxes and accounts, so the answer is per
	 * row and there is no route mailbox to take it from (#855).
	 */
	rows: readonly ThreadRowData[];
	/** Opens a row — the same navigation a click performs. */
	onOpen: (messageId: string, options?: OpenMessageOptions) => void;
	/** Deletes a set of messages. Absent disables the delete key for this list. */
	onDeleteMessages: (messageIds: string[]) => void;
	/**
	 * Runs a verb over the selection — which means opening the wizard on it, the
	 * one place a bulk action is reviewed before it reaches the mail server
	 * (#477 1.4). The provider never runs one itself, so no surface can grow a
	 * second unreviewed route to the same verb.
	 */
	onSelectionVerb: (verb: Verb) => void;
	/** The wizard owns the screen, so this list's keyboard layer stands down. */
	wizardOpen?: boolean;
	isDeleting?: boolean;
	commandsRef?: RefObject<MessageListCommands | null>;
	onTriageContextChange?: (context: TriageContextUpdate) => void;
	children?: ReactNode;
}

export function ThreadListInteraction({
	selectedMessageId,
	rows,
	onOpen,
	onDeleteMessages,
	onSelectionVerb,
	wizardOpen = false,
	isDeleting = false,
	commandsRef,
	onTriageContextChange,
	children,
}: ThreadListInteractionProps) {
	const isDesktop = useIsDesktop();
	const { pushError } = useErrorBanners();
	const containerRef = useRef<HTMLDivElement>(null);
	const orderedIds = useRenderedRowIds(containerRef);
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
	const { selectedIds, selectedCount, isSelected, toggle, select, toggleAll } =
		selection;

	const allSelected =
		orderedIds.length > 0 && orderedIds.every((id) => selectedIds.has(id));
	const toggleAllLoaded = useCallback(() => {
		if (orderedIds.length > 0) toggleAll(orderedIds);
	}, [orderedIds, toggleAll]);

	// A row that leaves the list — a chip filter, a collapsed section, a
	// completed delete — cannot stay selected. Survivors keep their selection.
	const { intersectWith } = selection;
	useEffect(() => {
		intersectWith(orderedIds);
	}, [intersectWith, orderedIds]);

	// Real browser focus follows the cursor, so Tab, Shift+Tab and the focus ring
	// agree with what the list highlights.
	useEffect(() => {
		const pending = pendingDomFocusRef.current;
		if (pending === null) return;
		pendingDomFocusRef.current = null;
		containerRef.current
			?.querySelector<HTMLElement>(`[data-message-id="${pending}"]`)
			?.focus();
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

	// The reading pane follows the cursor on desktop. Suspended while rows are
	// selected: the cursor is then picking out a set, and the selection bar — not
	// a message — is what the user is looking at.
	const followOpen = useCallback(
		(messageId: string) => onOpen(messageId, { replace: true }),
		[onOpen],
	);
	useFollowFocusOpen({
		keyboardFocusedMessageId: cursor.keyboardFocusedMessageId,
		openMessageId: selectedMessageId,
		enabled: isDesktop && selectedCount === 0,
		open: followOpen,
	});

	// Pending delete for the row under the cursor, awaiting confirmation. Both
	// the id and the folder it is filed in are snapshotted at request time, so
	// neither a cursor move nor a background refresh behind the dialog can
	// retarget it or change the question it is asking. A delete over a selection
	// is a bulk action and walks the wizard instead — the same contract the
	// mailbox list's delete has.
	const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
		null,
	);
	const { outcome: deleteOutcome, staleFolderLabel } = useDeleteOutcome(
		pendingDelete?.targets ?? NO_TARGETS,
	);

	// A verb, routed the same way the bar routes its own (#477 1.4, #508). Over a
	// selection every verb opens the wizard, so the keyboard cannot reach a bulk
	// action the bar would have reviewed. Over a bare cursor only Delete is this
	// list's, and it keeps its confirmation.
	const requestVerb = useCallback(
		(verb: Verb): boolean => {
			// The confirmation is already asking about a delete: the keypress belongs
			// to it. Claiming the press here is what stops a second Delete from
			// reaching an unconfirmed delete.
			if (pendingDelete !== null) return true;
			if (selectedCount > 0) {
				onSelectionVerb(verb);
				return true;
			}
			if (verb !== "delete" || !focusedMessageId) return false;
			// A row this list cannot place is a row whose delete cannot be worded,
			// and a confirmation nobody can answer is worse than no confirmation.
			// The press is still claimed — handing it back runs the pane's own
			// unconfirmed delete — and the refusal is said out loud, with the one
			// control that can actually change the answer.
			const pending = rows.find((row) => row.id === focusedMessageId);
			if (!pending?.mailboxId || !pending.accountId) {
				pushError({
					title: "Couldn't delete this message",
					detail:
						"This list has lost track of which account and folder it is in, so reader can't tell whether deleting it would move it to Trash or erase it. Nothing was deleted.",
					action: { label: "Reload the list", href: window.location.href },
				});
				return true;
			}
			setPendingDelete({
				ids: [focusedMessageId],
				targets: [
					{ accountId: pending.accountId, mailboxId: pending.mailboxId },
				],
			});
			return true;
		},
		[
			pendingDelete,
			selectedCount,
			onSelectionVerb,
			focusedMessageId,
			rows,
			pushError,
		],
	);

	const confirmDelete = useCallback(
		(ids: string[]) => {
			if (ids.length === 0) return;
			onDeleteMessages(ids);
			setPendingDelete(null);
			exitSelection();
		},
		[onDeleteMessages, exitSelection],
	);

	const cancelDelete = useCallback(() => setPendingDelete(null), []);

	const clearSelectionCommand = useCallback((): boolean => {
		if (selectedCount === 0) return false;
		exitSelection();
		return true;
	}, [selectedCount, exitSelection]);

	const hasList = orderedIds.length > 0;

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
			requestVerb,
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
		requestVerb,
	]);

	const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);
	const confirmOpen = pendingDelete !== null;
	useEffect(() => {
		onTriageContextChange?.({
			focusedMessageId,
			selectedIds: selectedIdList,
			orderedIds,
			hasList,
			// The dialog and the wizard each own the keyboard while they are up, so
			// the triage layer suspends rather than acting behind them: a second
			// Delete must not reach a delete, and no shortcut may start a second flow
			// behind the screen already asking about one.
			blocksKeyboard: confirmOpen || wizardOpen,
		});
	}, [
		onTriageContextChange,
		focusedMessageId,
		selectedIdList,
		orderedIds,
		hasList,
		confirmOpen,
		wizardOpen,
	]);

	const tabStop = tabStopId(orderedIds, focusedMessageId);

	const value = useMemo<ThreadListInteractionValue>(
		() => ({
			selectedIds,
			selectedCount,
			exitSelection,
			startSelectionVerb: onSelectionVerb,
			orderedIds,
			allSelected,
			toggleAllLoaded,
			rowInteraction: (messageId: string) => ({
				focused: messageId === focusedMessageId,
				isTabStop: messageId === tabStop,
				isDesktop,
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
			onSelectionVerb,
			orderedIds,
			allSelected,
			toggleAllLoaded,
			focusedMessageId,
			tabStop,
			isDesktop,
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
			{/* `display: contents` so reading the rendered rows costs the layout
			    nothing — the children lay out against their real parent. */}
			<div ref={containerRef} className="contents">
				{children}
			</div>
			<DeleteConfirmDialog
				isOpen={confirmOpen}
				messageIds={pendingDelete?.ids ?? []}
				outcome={deleteOutcome}
				accountId={pendingDelete?.targets[0]?.accountId}
				staleFolderLabel={staleFolderLabel}
				isDeleting={isDeleting}
				onConfirm={confirmDelete}
				onCancel={cancelDelete}
			/>
		</ThreadListInteractionCtx.Provider>
	);
}

interface ThreadListSelectionBarProps {
	/** The view's own name, used until the enclosing header supplies one. */
	title: string;
	isDeleting?: boolean;
}

/**
 * The starred list's header, which is also its selection bar — the same
 * surface the mailbox list and the brief raise, with the same rule: every verb
 * on it opens the wizard, and the review screen there is what names the action
 * before it reaches the mail server (#477 1.4).
 *
 * Move is not offered here: starred mail spans accounts and mailboxes, and a
 * move picker needs one account and one source folder to be honest about where
 * the messages go. Delete and mark-read carry no such scope.
 */
export function ThreadListSelectionBar({
	title,
	isDeleting,
}: ThreadListSelectionBarProps) {
	const chrome = useListHeaderChrome();
	const {
		selectedCount,
		exitSelection,
		startSelectionVerb,
		orderedIds,
		allSelected,
		toggleAllLoaded,
	} = useThreadListSelection();

	return (
		<SelectionTopBar
			title={chrome.title || title}
			navSlot={chrome.navSlot}
			titleMeta={chrome.titleMeta}
			searchSlot={chrome.searchSlot}
			searchField={chrome.searchField}
			idleSlot={chrome.makeFilterSlot}
			count={selectedCount}
			onCancel={exitSelection}
			onDelete={() => startSelectionVerb("delete")}
			onMarkRead={() => startSelectionVerb("markRead")}
			isBusy={isDeleting}
			selectAll={
				orderedIds.length > 0
					? {
							checked: allSelected,
							indeterminate: selectedCount > 0 && !allSelected,
							onChange: toggleAllLoaded,
						}
					: undefined
			}
		/>
	);
}
