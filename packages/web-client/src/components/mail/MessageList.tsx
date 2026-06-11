import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type { Density } from "@remit/ui";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useToggleReadFor } from "@/hooks/useMarkAsRead";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import {
	nextFocusId,
	type SelectionModifiers,
	useSelection,
} from "@/hooks/useSelection";
import { formatDeleteToTrashTitle } from "@/lib/format";
import { MobileSelectionTopBar } from "./MobileSelectionTopBar";
import { SelectionToolbar } from "./SelectionToolbar";
import { SwipeableMessageRow } from "./SwipeableMessageRow";

interface MessageListProps {
	mailboxId: string;
	threads: RemitImapThreadMessageResponse[];
	selectedMessageId?: string;
	isLoading: boolean;
	isError?: boolean;
	error?: unknown;
	onRetry?: () => void;
	searchQuery?: string;
	onDeleteMessages?: (messageIds: string[]) => void;
	onMarkAsRead?: (messageIds: string[]) => void;
	onMoveMessages?: (messageIds: string[], destinationMailboxId: string) => void;
	isDeleting?: boolean;
	isMoving?: boolean;
	onLoadMore?: () => void;
	hasMore?: boolean;
	isLoadingMore?: boolean;
	/**
	 * Owning account for the current mailbox view. Required for the Move
	 * action — when missing or when the selection spans multiple accounts
	 * the toolbar disables Move and surfaces an inline hint.
	 */
	accountId?: string;
	/**
	 * Triage-layer context bridge (#429). The roving focus cursor and the
	 * multi-selection live here; the parent route's global keyboard dispatcher
	 * needs them to target the action verbs (reply/archive/star/…) at the
	 * focused row, or the selection when one exists. Called whenever either
	 * changes. `focusedMessageId` is the keyboard cursor (distinct from the
	 * open/selected thread in the URL); `selectedIds` is the checkbox set.
	 */
	onTriageContextChange?: (context: {
		focusedMessageId: string | undefined;
		selectedIds: string[];
	}) => void;
}

const COMFORTABLE_ITEM_HEIGHT = 72;
const COMPACT_ITEM_HEIGHT = 32;
const OVERSCAN_COUNT = 5;
const DENSITY_STORAGE_KEY = "remit:list-density";

const readStoredDensity = (): Density => {
	try {
		const stored = localStorage.getItem(DENSITY_STORAGE_KEY);
		if (stored === "compact" || stored === "comfortable") return stored;
	} catch {
		// localStorage unavailable (SSR, privacy mode) — fall through
	}
	return "comfortable";
};

const LoadingSkeleton = () => (
	<div className="space-y-0">
		{Array.from({ length: 8 }).map((_, i) => (
			<div key={i} className="px-3 py-2 border-b border-line animate-pulse">
				<div className="flex items-center justify-between mb-2">
					<div className="h-4 bg-surface-sunken rounded w-32" />
					<div className="h-3 bg-surface-sunken rounded w-16" />
				</div>
				<div className="h-4 bg-surface-sunken rounded w-48 mb-2" />
				<div className="h-3 bg-surface-sunken rounded w-full" />
			</div>
		))}
	</div>
);

const SearchResultsHeader = ({
	query,
	count,
}: {
	query: string;
	count: number;
}) => (
	<div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-surface-sunken/30">
		<Search className="size-4 text-fg-muted" />
		<span className="text-sm text-fg-muted">
			{count} {count === 1 ? "result" : "results"} for "{query}"
		</span>
	</div>
);

export const MessageList = ({
	mailboxId,
	threads,
	selectedMessageId,
	isLoading,
	isError = false,
	error,
	onRetry,
	searchQuery,
	onDeleteMessages,
	onMarkAsRead,
	onMoveMessages,
	isDeleting = false,
	isMoving = false,
	onLoadMore,
	hasMore = false,
	isLoadingMore = false,
	accountId,
	onTriageContextChange,
}: MessageListProps) => {
	const parentRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

	// Roving focus cursor (#429): the keyboard "where am I" pointer, distinct
	// from the open thread (`selectedMessageId` in the URL). j/k move this
	// cursor without opening; Enter opens the focused row → sets selected. It
	// seeds from the open thread so opening a message also focuses its row, and
	// click-to-open keeps working unchanged (the route still navigates).
	const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>(
		selectedMessageId,
	);

	// Density toggle: comfortable (default) or compact (mutt mode).
	// Persisted to localStorage so the choice survives reloads.
	const [density, setDensity] = useState<Density>(readStoredDensity);
	const toggleDensity = useCallback(() => {
		setDensity((prev) => {
			const next: Density = prev === "comfortable" ? "compact" : "comfortable";
			try {
				localStorage.setItem(DENSITY_STORAGE_KEY, next);
			} catch {
				// ignore
			}
			return next;
		});
	}, []);

	// Swipe-to-read toggle hook
	const { toggleReadFor } = useToggleReadFor({ mailboxId });

	// Selection state
	const {
		selectedIds,
		selectedCount,
		hasSelection,
		isSelected: isChecked,
		toggle: toggleCheck,
		select,
		clearSelection,
		selectRange,
		setAnchor,
		selectAll,
	} = useSelection();

	// Ids queued for deletion, awaiting confirmation. `null` means the dialog
	// is closed. Snapshotted at request time so a selection change behind the
	// dialog can't retarget the delete.
	const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(
		null,
	);

	// Auto-exit multi-select when selection becomes empty
	useEffect(() => {
		if (isMultiSelectMode && selectedCount === 0) {
			setIsMultiSelectMode(false);
		}
	}, [isMultiSelectMode, selectedCount]);

	const virtualizer = useVirtualizer({
		count: threads.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () =>
			density === "compact" ? COMPACT_ITEM_HEIGHT : COMFORTABLE_ITEM_HEIGHT,
		overscan: OVERSCAN_COUNT,
	});

	// Index of the open thread (for scroll-into-view of the reading pane target).
	const currentIndex = selectedMessageId
		? threads.findIndex((t) => t.messageId === selectedMessageId)
		: -1;

	// Index of the roving focus cursor — what j/k move.
	const focusIndex = focusedMessageId
		? threads.findIndex((t) => t.messageId === focusedMessageId)
		: -1;

	// Move the focus cursor by index. In multi-select mode (mobile) j/k still
	// toggle selection rather than moving a cursor, preserving prior behavior.
	const moveFocusToIndex = useCallback(
		(index: number) => {
			if (index < 0 || index >= threads.length) return;
			const thread = threads[index];
			if (isMultiSelectMode) {
				toggleCheck(thread.messageId);
				return;
			}
			setFocusedMessageId(thread.messageId);
		},
		[threads, isMultiSelectMode, toggleCheck],
	);

	// j / ArrowDown: move focus to the next row (no open). Starts at the top
	// when nothing is focused yet.
	const focusNext = useCallback(() => {
		if (threads.length === 0) return;
		const nextIndex =
			focusIndex < 0 ? 0 : Math.min(focusIndex + 1, threads.length - 1);
		moveFocusToIndex(nextIndex);
	}, [threads.length, focusIndex, moveFocusToIndex]);

	// k / ArrowUp: move focus to the previous row.
	const focusPrevious = useCallback(() => {
		if (threads.length === 0) return;
		const prevIndex = focusIndex <= 0 ? 0 : focusIndex - 1;
		moveFocusToIndex(prevIndex);
	}, [threads.length, focusIndex, moveFocusToIndex]);

	// Toggle selection on the focused row with x.
	const toggleFocusedSelection = useCallback(() => {
		if (focusedMessageId) {
			toggleCheck(focusedMessageId);
		}
	}, [focusedMessageId, toggleCheck]);

	// Desktop mouse selection semantics (Apple Mail / Gmail model). Called by a
	// row's onClick with the click modifiers. Returns true when selection
	// handled the click (caller should preventDefault and skip navigation);
	// false for a plain click (caller lets the Link navigate).
	const orderedIds = useMemo(() => threads.map((t) => t.messageId), [threads]);
	const handleRowSelect = useCallback(
		(messageId: string, modifiers: SelectionModifiers): boolean => {
			if (modifiers.shiftKey) {
				selectRange(orderedIds, messageId);
				return true;
			}
			if (modifiers.metaKey || modifiers.ctrlKey) {
				// Toggle membership and re-anchor on the clicked row.
				toggleCheck(messageId);
				return true;
			}
			// Plain click: collapse any multi-selection and let navigation proceed.
			// The clicked row becomes the next anchor for a subsequent shift-click,
			// but is NOT added to the checkbox set (no toolbar on a plain open).
			clearSelection();
			setAnchor(messageId);
			return false;
		},
		[orderedIds, selectRange, toggleCheck, clearSelection, setAnchor],
	);

	// Open the delete confirmation for an explicit set of ids. All delete
	// entry points (toolbar Trash2, Delete/Backspace key) funnel through here
	// so the move-to-Trash confirmation is consistent.
	const requestDelete = useCallback(
		(ids: string[]) => {
			if (!onDeleteMessages || ids.length === 0) return;
			setPendingDeleteIds(ids);
		},
		[onDeleteMessages],
	);

	// Keyboard shift-arrow range extend: move focus one row in `direction` and
	// extend the selection range from the existing anchor to the new focus —
	// the keyboard equivalent of shift-click. The anchor stays fixed across
	// consecutive shift-arrows (selectRange seeds it only when unset), so
	// moving back toward the anchor shrinks the range.
	const extendRange = useCallback(
		(direction: -1 | 1) => {
			const target = nextFocusId(orderedIds, focusedMessageId, direction);
			if (target === undefined) return;
			selectRange(orderedIds, target);
			// Shift+arrow moves the focus cursor (not the open thread) and grows
			// the selection from the anchor — the keyboard equivalent of
			// shift-click.
			setFocusedMessageId(target);
		},
		[orderedIds, focusedMessageId, selectRange],
	);

	const extendRangeUp = useCallback(() => extendRange(-1), [extendRange]);
	const extendRangeDown = useCallback(() => extendRange(1), [extendRange]);

	// Cmd/Ctrl+A: select every currently loaded row.
	const handleSelectAll = useCallback(() => {
		if (orderedIds.length > 0) {
			selectAll(orderedIds);
		}
	}, [orderedIds, selectAll]);

	// Delete / Backspace: confirm-delete the selection, or the focused row when
	// nothing is selected.
	const handleDeleteKey = useCallback(() => {
		if (selectedCount > 0) {
			requestDelete(Array.from(selectedIds));
		} else if (focusedMessageId) {
			requestDelete([focusedMessageId]);
		}
	}, [selectedCount, selectedIds, focusedMessageId, requestDelete]);

	// Enter: open the focused row in the reading pane (sets selected/URL). This
	// is the focus→open transition of the 2-state model.
	const handleOpenFocused = useCallback(() => {
		if (!focusedMessageId) return;
		navigate({
			to: "/mail/$mailboxId",
			params: { mailboxId },
			search: (prev) => ({ ...prev, selectedMessageId: focusedMessageId }),
		});
	}, [focusedMessageId, navigate, mailboxId]);

	// Toolbar Trash2: confirm-delete the current selection.
	const handleDelete = useCallback(() => {
		if (selectedCount > 0) {
			requestDelete(Array.from(selectedIds));
		}
	}, [requestDelete, selectedCount, selectedIds]);

	// Confirm handler: run the actual bulk delete, then clear selection and
	// move focus to a sensible neighbor (the row after the first deleted one).
	const handleConfirmDelete = useCallback(() => {
		if (!pendingDeleteIds || pendingDeleteIds.length === 0) {
			setPendingDeleteIds(null);
			return;
		}
		const deletedSet = new Set(pendingDeleteIds);
		const firstDeletedIndex = threads.findIndex((t) =>
			deletedSet.has(t.messageId),
		);
		// Next surviving row at or after the first deleted row, else the one
		// before it. Computed against the pre-delete order.
		let nextFocus: string | undefined;
		for (let i = firstDeletedIndex + 1; i < threads.length; i++) {
			if (!deletedSet.has(threads[i].messageId)) {
				nextFocus = threads[i].messageId;
				break;
			}
		}
		if (nextFocus === undefined) {
			for (let i = firstDeletedIndex - 1; i >= 0; i--) {
				if (!deletedSet.has(threads[i].messageId)) {
					nextFocus = threads[i].messageId;
					break;
				}
			}
		}

		onDeleteMessages?.(pendingDeleteIds);
		clearSelection();
		setPendingDeleteIds(null);

		if (nextFocus !== undefined) {
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: (prev) => ({ ...prev, selectedMessageId: nextFocus }),
				replace: true,
			});
		}
	}, [
		pendingDeleteIds,
		threads,
		onDeleteMessages,
		clearSelection,
		navigate,
		mailboxId,
	]);

	const handleCancelDelete = useCallback(() => {
		setPendingDeleteIds(null);
	}, []);

	// Handle mark as read
	const handleMarkAsRead = useCallback(() => {
		if (onMarkAsRead && selectedCount > 0) {
			onMarkAsRead(Array.from(selectedIds));
		}
	}, [onMarkAsRead, selectedCount, selectedIds]);

	// Handle move
	const handleMoveSelected = useCallback(
		(destinationMailboxId: string) => {
			if (!onMoveMessages || selectedCount === 0) return;
			onMoveMessages(Array.from(selectedIds), destinationMailboxId);
			clearSelection();
		},
		[onMoveMessages, selectedCount, selectedIds, clearSelection],
	);

	// Cross-account guard: every selected thread row must belong to the
	// same account as the current mailbox. The list is already scoped to
	// one mailbox so in practice this is always single-account, but we
	// detect drift defensively (e.g. a future global selection mode) and
	// disable Move with an inline hint rather than silently aggregating.
	//
	// `MessageList` re-renders on every virtualizer scroll tick. Memoize
	// the guard so we only walk the selected slice when selection or
	// thread identity actually changes.
	const moveDisabledHint = useMemo(() => {
		if (selectedCount === 0) return undefined;
		const selectedAccountConfigIds = new Set<string>();
		for (const thread of threads) {
			if (selectedIds.has(thread.messageId)) {
				selectedAccountConfigIds.add(thread.accountConfigId);
			}
		}
		if (selectedAccountConfigIds.size > 1) {
			return "Move only works within one account — clear selection or pick messages from a single account";
		}
		return undefined;
	}, [selectedCount, selectedIds, threads]);

	// Swipe-to-delete single message
	const handleSwipeDelete = useCallback(
		(messageId: string) => {
			onDeleteMessages?.([messageId]);
		},
		[onDeleteMessages],
	);

	// Swipe-to-toggle-read single message
	const handleSwipeToggleRead = useCallback(
		(messageId: string, currentIsRead: boolean) => {
			toggleReadFor([messageId], !currentIsRead);
		},
		[toggleReadFor],
	);

	// Mobile: Enter multi-select mode on long press
	const handleLongPress = useCallback(
		(messageId: string) => {
			if (!isDesktop) {
				setIsMultiSelectMode(true);
				select(messageId);
			}
		},
		[isDesktop, select],
	);

	// Cancel multi-select mode
	const handleCancelMultiSelect = useCallback(() => {
		setIsMultiSelectMode(false);
		clearSelection();
	}, [clearSelection]);

	// Scroll the roving focus cursor into view as it moves (j/k). Falls back to
	// the open thread when nothing is focused yet.
	useEffect(() => {
		const target = focusIndex >= 0 ? focusIndex : currentIndex;
		if (target >= 0) {
			virtualizer.scrollToIndex(target, { align: "auto" });
		}
	}, [focusIndex, currentIndex, virtualizer]);

	// Opening a thread (click or Enter, anywhere) seeds the focus cursor onto it
	// so subsequent j/k continue from the open row — focus and open stay in
	// sync on open while remaining independent during scanning.
	useEffect(() => {
		if (selectedMessageId) {
			setFocusedMessageId(selectedMessageId);
		}
	}, [selectedMessageId]);

	// Keep the focus cursor valid as the thread list changes (after delete /
	// move / refetch). If the focused row vanished, snap to the nearest
	// surviving row so j/k never dead-ends.
	useEffect(() => {
		if (!focusedMessageId) return;
		if (threads.some((t) => t.messageId === focusedMessageId)) return;
		setFocusedMessageId(threads[0]?.messageId);
	}, [threads, focusedMessageId]);

	// Bridge the roving cursor + selection up to the route's global keyboard
	// dispatcher (#429) so the action verbs can target the focused row, or the
	// selection when one exists.
	useEffect(() => {
		onTriageContextChange?.({
			focusedMessageId,
			selectedIds: Array.from(selectedIds),
		});
	}, [focusedMessageId, selectedIds, onTriageContextChange]);

	// Clear selection when threads change (e.g., after delete)
	useEffect(() => {
		const threadIds = new Set(threads.map((t) => t.messageId));
		const hasOrphanedSelection = Array.from(selectedIds).some(
			(id) => !threadIds.has(id),
		);
		if (hasOrphanedSelection) {
			clearSelection();
		}
	}, [threads, selectedIds, clearSelection]);

	// Load more when scrolling near the bottom
	useEffect(() => {
		const scrollElement = parentRef.current;
		if (!scrollElement || !hasMore || !onLoadMore) return;

		const handleScroll = () => {
			if (isLoadingMore) return;

			const { scrollTop, scrollHeight, clientHeight } = scrollElement;
			// Trigger when within 200px of the bottom
			const nearBottom = scrollTop + clientHeight >= scrollHeight - 200;

			if (nearBottom) {
				onLoadMore();
			}
		};

		scrollElement.addEventListener("scroll", handleScroll, { passive: true });
		// Also check immediately in case we're already at the bottom
		handleScroll();

		return () => scrollElement.removeEventListener("scroll", handleScroll);
	}, [hasMore, isLoadingMore, onLoadMore]);

	// Keyboard navigation. The dialog owns the keyboard while open, so list
	// shortcuts pause to avoid double-handling (e.g. a second Delete press).
	useKeyboardNavigation({
		enabled: !isLoading && threads.length > 0 && pendingDeleteIds === null,
		bindings: [
			// Focus movement (plain). requireShift:false so Shift+Arrow falls
			// through to the range-extend bindings below instead of also moving
			// focus without selecting. j/k move the roving cursor WITHOUT opening
			// the thread (#429) — only Enter / click open.
			{ key: "j", handler: focusNext, preventDefault: true },
			{
				key: "ArrowDown",
				handler: focusNext,
				preventDefault: true,
				requireShift: false,
			},
			{ key: "k", handler: focusPrevious, preventDefault: true },
			{
				key: "ArrowUp",
				handler: focusPrevious,
				preventDefault: true,
				requireShift: false,
			},
			// Shift+Arrow: extend the selection range.
			{
				key: "ArrowDown",
				handler: extendRangeDown,
				preventDefault: true,
				requireShift: true,
			},
			{
				key: "ArrowUp",
				handler: extendRangeUp,
				preventDefault: true,
				requireShift: true,
			},
			// Toggle focused row (x or Space) and re-anchor.
			{ key: "x", handler: toggleFocusedSelection, preventDefault: true },
			{ key: " ", handler: toggleFocusedSelection, preventDefault: true },
			// Cmd/Ctrl+A select all loaded rows.
			{
				key: "a",
				handler: handleSelectAll,
				preventDefault: true,
				requireMeta: true,
			},
			// Enter opens the focused message.
			{ key: "Enter", handler: handleOpenFocused, preventDefault: true },
			// Delete / Backspace: confirm-delete selection or focused row.
			{ key: "Delete", handler: handleDeleteKey, preventDefault: true },
			{ key: "Backspace", handler: handleDeleteKey, preventDefault: true },
			// d: toggle density (comfortable / compact).
			{ key: "d", handler: toggleDensity, preventDefault: true },
		],
	});

	// Esc-to-clear-selection on the capture phase, enabled only when a
	// selection exists. Capture + stopPropagation makes a single Esc clear the
	// selection and consume the keypress, so the route-level Esc (go back) does
	// NOT also fire. With no selection this listener is disabled and Esc falls
	// through to the route as before. The ConfirmDialog (when open) registers
	// its own capture-phase Esc and pauses these list shortcuts, so its cancel
	// still wins first.
	useKeyboardNavigation({
		enabled: hasSelection && pendingDeleteIds === null,
		capture: true,
		bindings: [
			{
				key: "Escape",
				handler: clearSelection,
				preventDefault: true,
				stopPropagation: true,
			},
		],
	});

	if (isLoading) {
		return <LoadingSkeleton />;
	}

	if (isError) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<ErrorState
					title="Couldn't load messages"
					error={error}
					onRetry={onRetry}
				/>
			</div>
		);
	}

	const isSearching = !!searchQuery?.trim();

	if (threads.length === 0) {
		return (
			<div className="flex flex-col h-full">
				{isSearching && searchQuery && (
					<SearchResultsHeader query={searchQuery} count={0} />
				)}
				<div className="flex flex-1 items-center justify-center">
					<EmptyState
						message={
							isSearching
								? "No messages match your search"
								: "No messages in this mailbox"
						}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full">
			{hasSelection && isDesktop && (
				<SelectionToolbar
					selectedCount={selectedCount}
					onDelete={handleDelete}
					onClearSelection={clearSelection}
					onMarkAsRead={onMarkAsRead ? handleMarkAsRead : undefined}
					onMove={onMoveMessages ? handleMoveSelected : undefined}
					isDeleting={isDeleting}
					isMoving={isMoving}
					accountId={accountId}
					currentMailboxId={mailboxId}
					moveDisabledHint={moveDisabledHint}
				/>
			)}
			{isMultiSelectMode && !isDesktop && (
				<MobileSelectionTopBar
					selectedCount={selectedCount}
					onCancel={handleCancelMultiSelect}
					onDelete={handleDelete}
					onMarkAsRead={onMarkAsRead ? handleMarkAsRead : undefined}
					onMove={onMoveMessages ? handleMoveSelected : undefined}
					isBusy={isDeleting || isMoving}
					accountId={accountId}
					currentMailboxId={mailboxId}
					moveDisabledHint={moveDisabledHint}
				/>
			)}
			{isSearching && searchQuery && (
				<SearchResultsHeader query={searchQuery} count={threads.length} />
			)}
			<div ref={parentRef} className="flex-1 overflow-y-auto" tabIndex={0}>
				<div
					className="relative w-full"
					style={{ height: `${virtualizer.getTotalSize()}px` }}
				>
					{virtualizer.getVirtualItems().map((virtualRow) => {
						const thread = threads[virtualRow.index];
						return (
							<div
								key={virtualRow.key}
								data-index={virtualRow.index}
								ref={virtualizer.measureElement}
								className="absolute left-0 top-0 w-full border-b border-line"
								style={{ transform: `translateY(${virtualRow.start}px)` }}
							>
								<SwipeableMessageRow
									thread={thread}
									mailboxId={mailboxId}
									isSelected={selectedMessageId === thread.messageId}
									isFocused={focusedMessageId === thread.messageId}
									isChecked={isChecked(thread.messageId)}
									onToggleCheck={toggleCheck}
									onRowSelect={handleRowSelect}
									isMultiSelectMode={isMultiSelectMode}
									onLongPress={handleLongPress}
									isDesktop={isDesktop}
									onDelete={handleSwipeDelete}
									onToggleRead={handleSwipeToggleRead}
									density={density}
								/>
							</div>
						);
					})}
				</div>
				{isLoadingMore && (
					<div className="flex justify-center py-4">
						<div className="h-5 w-5 animate-spin rounded-full border-2 border-fg-muted border-t-transparent" />
					</div>
				)}
			</div>
			<ConfirmDialog
				isOpen={pendingDeleteIds !== null}
				title={formatDeleteToTrashTitle(pendingDeleteIds?.length ?? 0)}
				description="You can restore them from Trash later."
				confirmLabel="Move to Trash"
				destructive
				isBusy={isDeleting}
				onConfirm={handleConfirmDelete}
				onCancel={handleCancelDelete}
			/>
		</div>
	);
};
