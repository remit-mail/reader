import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	Banner,
	type Density,
	MessageListPane,
	SelectionTopBar,
} from "@remit/ui";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, Sparkles } from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import {
	type EscalationSearchQuery,
	useEscalatedDelete,
} from "@/hooks/useEscalatedDelete";
import { useToggleReadFor } from "@/hooks/useMarkAsRead";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import {
	nextFocusId,
	type SelectionModifiers,
	useSelection,
} from "@/hooks/useSelection";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";
import {
	BULK_DELETE_CHUNK_SIZE,
	resolveSelectionAfterDelete,
} from "@/lib/bulk-delete";
import {
	escalatedStatusLabel,
	escalationActionLabel,
} from "@/lib/escalation-label";
import { formatDeleteToTrashTitle, formatNumber } from "@/lib/format";
import { tabStopId } from "@/lib/list-focus";
import { cn } from "@/lib/utils";
import { MoveToTrigger } from "./MoveToTrigger";
import { OrganizeDialog } from "./organize/OrganizeDialog";
import { SelectionToolbar } from "./SelectionToolbar";
import { SwipeableMessageRow } from "./SwipeableMessageRow";

/**
 * The list operations the global keyboard layer drives. The list publishes an
 * implementation into a ref the route owns, so navigation and selection keys
 * are routed by the one dispatcher in `useTriageKeyboard` instead of a second
 * window listener of the list's own (#43).
 */
export interface MessageListCommands {
	focusNext: () => void;
	focusPrevious: () => void;
	focusFirst: () => void;
	focusLast: () => void;
	openFocused: () => void;
	toggleSelect: () => void;
	extendSelectDown: () => void;
	extendSelectUp: () => void;
	selectAll: () => void;
	/** Returns true when there was a selection to clear — Esc consumes it. */
	clearSelection: () => boolean;
	/**
	 * Opens the move-to-Trash confirmation for the selection, or the focused row
	 * when nothing is selected. Returns false when there is nothing to delete, so
	 * the route can fall back to its own reading-pane delete.
	 */
	requestDelete: () => boolean;
	toggleDensity: () => void;
}

interface MessageListProps {
	mailboxId: string;
	threads: RemitImapThreadMessageResponse[];
	selectedMessageId?: string;
	isLoading: boolean;
	isError?: boolean;
	error?: unknown;
	onRetry?: () => void;
	searchQuery?: string;
	/**
	 * The active search predicate (undefined when not searching). Re-issued
	 * with fresh continuation tokens to page past what's loaded — the
	 * escalated select-all flow (issue #92) — since `searchQuery` above is
	 * only the display string.
	 */
	searchPredicate?: EscalationSearchQuery;
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
	 * Mailbox display title shown in the list pane header.
	 * The parent route owns the title; the list pane renders it.
	 */
	listTitle: string;
	/**
	 * Optional subtitle (e.g. "3 unread") shown alongside the title.
	 */
	listMeta?: string;
	/**
	 * Triage-layer context bridge (#429). The roving focus cursor and the
	 * multi-selection live here; the parent route's global keyboard dispatcher
	 * needs them to target the action verbs (reply/star/…) at the
	 * focused row, or the selection when one exists. Called whenever either
	 * changes. `focusedMessageId` is the keyboard cursor (distinct from the
	 * open/selected thread in the URL); `selectedIds` is the checkbox set.
	 */
	onTriageContextChange?: (context: {
		focusedMessageId: string | undefined;
		selectedIds: string[];
		/**
		 * Whether a list is mounted with commands published. The route registers
		 * its list-driven key handlers only while this holds, so keys the list
		 * owns (Enter, Space, ⌘A) are left to the browser everywhere else.
		 */
		hasList: boolean;
		/**
		 * Whether the list has a modal open that owns the keyboard. The route
		 * suspends the whole triage layer while it does, so no shortcut can act
		 * behind the dialog — a second Delete press must not reach a delete.
		 */
		blocksKeyboard: boolean;
	}) => void;
	/**
	 * Ref the list publishes its {@link MessageListCommands} into, so the route's
	 * keyboard dispatcher can drive navigation and selection. Cleared on unmount.
	 */
	commandsRef?: RefObject<MessageListCommands | null>;
	/**
	 * Suppress the pane's built-in title header — the shared `MailHeader` above
	 * the list owns it (the inbox renders inside `MailViewChrome`).
	 */
	hideHeader?: boolean;
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
			{count} {count === 1 ? "result" : "results"} for &ldquo;{query}&rdquo;
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
	searchPredicate,
	onDeleteMessages,
	onMarkAsRead,
	onMoveMessages,
	isDeleting = false,
	isMoving = false,
	onLoadMore,
	hasMore = false,
	isLoadingMore = false,
	accountId,
	listTitle,
	listMeta,
	onTriageContextChange,
	commandsRef,
	hideHeader = false,
}: MessageListProps) => {
	const parentRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
	const [organizeOpen, setOrganizeOpen] = useState(false);
	const isSearching = !!searchQuery?.trim();

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
		toggleAll,
		intersectWith,
	} = useSelection();

	// Pending delete, awaiting confirmation. `null` means the dialog is closed.
	// `source: "ids"` snapshots the concrete ids at request time so a selection
	// change behind the dialog can't retarget the delete — every keyboard/desktop
	// entry point, and any bounded mobile delete, uses this. `source: "predicate"`
	// is mobile-only: an escalated selection has no materialized id list to
	// snapshot (D2, issue #92) — only the count it was confirmed against.
	type PendingDelete =
		| { source: "ids"; ids: string[] }
		| { source: "predicate"; total: number };
	const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
		null,
	);

	// Search-scoped escalated selection + chunked bulk delete (issue #92):
	// mobile only, and only while search has more matches than are loaded.
	// `orderedIds` below feeds `allLoadedSelected`; declared after this hook so
	// its callback deps stay simple — see the `orderedIds`/`handleRowSelect`
	// block.
	const escalationEnabled = !isDesktop && isSearching && !!searchPredicate;
	const predicateKey = `${mailboxId}|${JSON.stringify(searchPredicate ?? {})}`;
	const escalation = useEscalatedDelete({
		mailboxId,
		accountId,
		enabled: escalationEnabled,
		predicateKey,
		searchQuery: searchPredicate ?? {},
	});
	// Non-null exactly once a bounded/escalated run just ended with some ids
	// still not confirmed deleted: the count that DID succeed in that run, so
	// the partial-failure notice can say "N moved to Trash" alongside "Retry".
	// `selectedIds` (materialized to the failed ids) is the source of truth for
	// how many are left; this only supplies the other half of that sentence.
	const [lastRunSucceeded, setLastRunSucceeded] = useState<number | null>(null);
	// Transient, manually-dismissed success banner shown in place of the
	// selection bar once a chunked/escalated delete finishes cleanly — see
	// `processDeleteOutcome`. Honest about IMAP's async catch-up rather than
	// claiming a finality the bulk endpoint's response doesn't have.
	const [completionBanner, setCompletionBanner] = useState<string | null>(null);

	// Set when a keyboard command moves the roving cursor. Real DOM focus then
	// follows the cursor onto the row once the virtualizer has rendered it, so
	// the browser's own focus — and therefore Tab, Shift+Tab and the focus ring
	// — agree with what the list highlights (#43). Mouse-driven focus changes
	// leave this null, so the list never yanks focus out of the reading pane.
	const pendingDomFocusRef = useRef<string | null>(null);

	// Whether the cursor's last move came from a row taking DOM focus — a click,
	// or the browser restoring focus — rather than from a command this list ran.
	// The list scrolls the cursor into view only for its own moves. Scrolling for
	// a click moves the row out from under the pointer between mousedown and the
	// click event, so the click lands on the empty space the row left behind and
	// nothing opens (#85). Only rows below the fold could hit it: the pointer has
	// to have scrolled to reach them, and the list then scrolled again on top of
	// that. Every command below resets this to false before moving the cursor.
	const cursorMovedByPointerRef = useRef(false);

	// The row the cursor was on when the delete confirmation opened. The dialog
	// takes DOM focus for as long as it is up, so dismissing it has to give that
	// focus back or the list is left with no cursor and the next shortcut acts on
	// nothing (#80).
	const focusBeforeConfirmRef = useRef<string | null>(null);

	// Whether the list can serve keyboard commands at all. It stays true while
	// the delete confirmation is open — withdrawing the commands there would let
	// the route fall through to its own unconfirmed delete on a second Delete
	// press. The route suspends the whole keyboard layer for the dialog instead.
	const commandsAvailable = !isLoading && threads.length > 0;
	const confirmOpen = pendingDelete !== null;

	// Auto-exit multi-select when selection becomes empty
	useEffect(() => {
		if (isMultiSelectMode && selectedCount === 0) {
			setIsMultiSelectMode(false);
		}
	}, [isMultiSelectMode, selectedCount]);

	// Single choke point for what selection looks like once a chunked/escalated
	// run ends, for any reason (issue #92 requirement 10). A clean run with
	// nothing left over exits selection mode and hands off to a transient
	// completion banner instead of silently claiming a finality the bulk
	// endpoint's response doesn't have (IMAP applies the move asynchronously).
	// Anything left over becomes the new bounded selection — precisely what
	// Retry resends, per `resolveSelectionAfterDelete`.
	const processDeleteOutcome = useCallback(
		(outcome: Parameters<typeof resolveSelectionAfterDelete>[0]) => {
			const { exit, retryIds } = resolveSelectionAfterDelete(outcome);
			if (exit) {
				setCompletionBanner(
					`${formatNumber(outcome.done)} moved to Trash. Your mail server is still catching up.`,
				);
				setLastRunSucceeded(null);
				clearSelection();
				return;
			}
			if (retryIds.length > 0) {
				setLastRunSucceeded(outcome.done);
				selectAll(retryIds);
				return;
			}
			setLastRunSucceeded(null);
		},
		[clearSelection, selectAll],
	);

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
			pendingDomFocusRef.current = thread.messageId;
			cursorMovedByPointerRef.current = false;
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

	const focusFirst = useCallback(() => moveFocusToIndex(0), [moveFocusToIndex]);
	const focusLast = useCallback(
		() => moveFocusToIndex(threads.length - 1),
		[moveFocusToIndex, threads.length],
	);

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
				// The open/focused row is the fallback origin when the stored anchor
				// has been filtered or searched out of the visible list, so the first
				// shift-click still ranges from where the user is (#142, #144).
				selectRange(orderedIds, messageId, focusedMessageId);
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
		[
			orderedIds,
			focusedMessageId,
			selectRange,
			toggleCheck,
			clearSelection,
			setAnchor,
		],
	);

	// Open the delete confirmation for an explicit set of ids. All delete
	// entry points (toolbar Trash2, Delete/Backspace key) funnel through here
	// so the move-to-Trash confirmation is consistent.
	const requestDelete = useCallback(
		(ids: string[]) => {
			if (!onDeleteMessages || ids.length === 0) return;
			focusBeforeConfirmRef.current = focusedMessageId ?? null;
			setPendingDelete({ source: "ids", ids });
		},
		[onDeleteMessages, focusedMessageId],
	);

	// Mobile-only: open the delete confirmation for the escalated predicate.
	// `escalation.phase` must already be "escalated" — the caller (the mobile
	// bar's onDelete) only wires this up in that state.
	const requestEscalatedDelete = useCallback(() => {
		if (escalation.phase.kind !== "escalated") return;
		focusBeforeConfirmRef.current = focusedMessageId ?? null;
		setPendingDelete({ source: "predicate", total: escalation.phase.total });
	}, [escalation.phase, focusedMessageId]);

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
			pendingDomFocusRef.current = target;
			cursorMovedByPointerRef.current = false;
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
	// Returns true when it took the keypress, so the route's fallback delete
	// (which skips the confirmation) doesn't also fire.
	const handleDeleteKey = useCallback((): boolean => {
		// The confirmation is already asking about a delete: the keypress belongs
		// to it, and answering it is the Confirm button's job. Claiming the press
		// here is what stops a second Delete from reaching an unconfirmed delete.
		if (pendingDelete !== null) return true;
		if (!onDeleteMessages) return false;
		if (selectedCount > 0) {
			requestDelete(Array.from(selectedIds));
			return true;
		}
		if (focusedMessageId) {
			requestDelete([focusedMessageId]);
			return true;
		}
		return false;
	}, [
		pendingDelete,
		onDeleteMessages,
		selectedCount,
		selectedIds,
		focusedMessageId,
		requestDelete,
	]);

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

	// Confirm handler for the escalated predicate, or a bounded selection past
	// the 100-id bulk-call cap (>100 loaded rows selected — rare, but the write
	// side would 400 on a single call past that). Neither case gets the
	// cursor-repositioning treatment below: the run takes real time and the
	// user's attention is on the progress bar, not the roving cursor, and
	// rows update via cache invalidation once the run ends rather than an
	// optimistic per-row removal.
	const runChunkedConfirmDelete = useCallback(
		async (ids: string[] | undefined) => {
			setPendingDelete(null);
			focusBeforeConfirmRef.current = null;
			const outcome = await escalation.runDelete(ids);
			processDeleteOutcome(outcome);
		},
		[escalation, processDeleteOutcome],
	);

	// Confirm handler: run the actual bulk delete, then clear selection and
	// move focus to a sensible neighbor (the row after the first deleted one).
	const handleConfirmDelete = useCallback(() => {
		if (!pendingDelete) return;

		if (pendingDelete.source === "predicate") {
			void runChunkedConfirmDelete(undefined);
			return;
		}

		const { ids } = pendingDelete;
		if (ids.length === 0) {
			setPendingDelete(null);
			return;
		}
		if (ids.length > BULK_DELETE_CHUNK_SIZE) {
			// Selection stays put (still `ids`) for the duration of the run —
			// `processDeleteOutcome` is the one place that clears it, on success,
			// or replaces it with whatever's left to retry.
			void runChunkedConfirmDelete(ids);
			return;
		}

		const deletedSet = new Set(ids);
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

		onDeleteMessages?.(ids);
		clearSelection();
		focusBeforeConfirmRef.current = null;
		setPendingDelete(null);

		if (nextFocus !== undefined) {
			// Same hand-back as cancelling, aimed at the surviving neighbour
			// instead: confirming also closes a dialog that held DOM focus.
			pendingDomFocusRef.current = nextFocus;
			cursorMovedByPointerRef.current = false;
			setFocusedMessageId(nextFocus);
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: (prev) => ({ ...prev, selectedMessageId: nextFocus }),
				replace: true,
			});
		}
	}, [
		pendingDelete,
		threads,
		onDeleteMessages,
		clearSelection,
		navigate,
		mailboxId,
		runChunkedConfirmDelete,
	]);

	// Every way out of the confirmation that isn't the delete — Escape, Cancel,
	// the backdrop — arrives here, so this is the one place the keyboard has to
	// be handed back. Restoring the cursor also puts DOM focus back on that row,
	// via the same pending-focus channel j/k use.
	const handleCancelDelete = useCallback(() => {
		const restoreTo = focusBeforeConfirmRef.current;
		focusBeforeConfirmRef.current = null;
		setPendingDelete(null);
		if (restoreTo === null) return;
		pendingDomFocusRef.current = restoreTo;
		cursorMovedByPointerRef.current = false;
		setFocusedMessageId(restoreTo);
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

	// Mobile bar's Trash tap: an escalated selection has no materialized ids to
	// hand `requestDelete`, so it opens the predicate confirmation instead.
	const handleMobileDelete = useCallback(() => {
		if (escalation.phase.kind === "escalated") {
			requestEscalatedDelete();
			return;
		}
		handleDelete();
	}, [escalation.phase, requestEscalatedDelete, handleDelete]);

	// Mobile bar's X: means "stop what's happening" throughout, not just
	// "cancel selection" (issue #92 — the review flagged the X reading as
	// ambiguous once a delete is running). Counting and deleting both stop at
	// the next page boundary; an escalated-but-idle selection drops back to
	// bounded on the way out, same as tapping "Clear selection" first.
	const handleMobileCancel = useCallback(() => {
		if (escalation.isDeleting || escalation.phase.kind === "counting") {
			escalation.stop();
			return;
		}
		if (escalation.phase.kind === "escalated") {
			escalation.clear();
		}
		handleCancelMultiSelect();
	}, [escalation, handleCancelMultiSelect]);

	// The escalation notice's "Clear selection" action: drop back to the
	// bounded (all-loaded) selection without touching selection mode itself.
	const handleClearEscalation = useCallback(() => {
		escalation.clear();
	}, [escalation]);

	// Partial-failure notice's Retry: resend exactly the ids that didn't
	// confirm deleted last time (`selectedIds`, materialized there by
	// `processDeleteOutcome`) — never the original selection.
	const handleRetryFailed = useCallback(() => {
		void runChunkedConfirmDelete(Array.from(selectedIds));
	}, [runChunkedConfirmDelete, selectedIds]);

	// Scroll the roving focus cursor into view as it moves (j/k). Falls back to
	// the open thread when nothing is focused yet.
	useEffect(() => {
		// A row that took focus from the pointer is already where the user aimed,
		// and scrolling it now would move it out from under the click still in
		// flight (#85).
		if (cursorMovedByPointerRef.current) return;
		// On single-pane tiers, opening a thread swaps this list out for the
		// conversation. Scrolling the list as it unmounts is both pointless (it's
		// no longer visible) and unsafe: @tanstack/react-virtual's scrollToIndex
		// schedules a requestAnimationFrame retry chain on the scroll element's
		// window, which throws once that element (and its window) are gone. Only
		// auto-scroll while the list stays mounted alongside the reading pane.
		if (!isDesktop && selectedMessageId) return;
		const target = focusIndex >= 0 ? focusIndex : currentIndex;
		if (target >= 0) {
			virtualizer.scrollToIndex(target, { align: "auto" });
		}
	}, [focusIndex, currentIndex, virtualizer, isDesktop, selectedMessageId]);

	// Opening a thread (click or Enter, anywhere) seeds the focus cursor onto it
	// so subsequent j/k continue from the open row — focus and open stay in
	// sync on open while remaining independent during scanning.
	useEffect(() => {
		if (selectedMessageId) {
			// A thread going open is the list's own move, whatever opened it — a
			// deep link arrives with the row far down and has to be scrolled to.
			cursorMovedByPointerRef.current = false;
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
			hasList: commandsAvailable,
			blocksKeyboard: confirmOpen,
		});
	}, [
		focusedMessageId,
		selectedIds,
		commandsAvailable,
		confirmOpen,
		onTriageContextChange,
	]);

	// Retract the context when the list goes away (drafts view, phone reading
	// view). Without this the route keeps its list key handlers registered
	// against a list that no longer exists, and goes on swallowing Enter, Space
	// and ⌘A on a screen that has no rows.
	const bridgeRef = useRef(onTriageContextChange);
	bridgeRef.current = onTriageContextChange;
	useEffect(
		() => () =>
			bridgeRef.current?.({
				focusedMessageId: undefined,
				selectedIds: [],
				hasList: false,
				blocksKeyboard: false,
			}),
		[],
	);

	// Narrow the selection when threads change (e.g., after delete), dropping
	// only the ids that left and keeping every survivor — K-9's
	// `selected.intersect(uniqueIds)`, the reference behavior #92's D2 cites.
	// Wiping the whole selection because one id left (#111) cost the other 49
	// rows on an ordinary refresh, and could take the post-delete Retry
	// selection with it: `processDeleteOutcome` materializes the failed ids as
	// the new selection and resets this effect to live by returning escalation
	// to idle, so the cache invalidation's refetch ran this same effect against
	// the retry set — a clear here would have dropped the Retry notice
	// (gated on `selectedCount > 0`) along with it.
	// Skipped while an escalated run is active: `selectedIds` there is a stale
	// loaded-rows snapshot from the moment escalation started (the real
	// selection is the predicate, D2), not something a background refetch
	// reshuffling `threads` should be allowed to narrow out from under a count
	// or a delete in progress — that would silently exit selection mode
	// mid-run.
	useEffect(() => {
		if (escalation.phase.kind !== "idle" || escalation.isDeleting) return;
		intersectWith(threads.map((t) => t.messageId));
	}, [threads, intersectWith, escalation.phase, escalation.isDeleting]);

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

	// Move real DOM focus onto the roving cursor after a keyboard move. The
	// virtualizer may not have rendered the row yet on the commit that moved the
	// cursor; the scroll effect above brings it in and this runs again on the
	// next commit, so the lookup retries until the row exists.
	useEffect(() => {
		const messageId = pendingDomFocusRef.current;
		if (!messageId) return;
		const row = parentRef.current?.querySelector<HTMLElement>(
			`[data-message-id="${messageId}"]`,
		);
		if (!row) return;
		pendingDomFocusRef.current = null;
		row.focus({ preventScroll: true });
	});

	useEffect(() => {
		if (!commandsRef) return;
		if (!commandsAvailable) {
			commandsRef.current = null;
			return;
		}
		commandsRef.current = {
			focusNext,
			focusPrevious,
			focusFirst,
			focusLast,
			openFocused: handleOpenFocused,
			toggleSelect: toggleFocusedSelection,
			extendSelectDown: extendRangeDown,
			extendSelectUp: extendRangeUp,
			selectAll: handleSelectAll,
			clearSelection: () => {
				if (!hasSelection) return false;
				clearSelection();
				return true;
			},
			requestDelete: handleDeleteKey,
			toggleDensity,
		};
		return () => {
			commandsRef.current = null;
		};
	}, [
		commandsRef,
		commandsAvailable,
		focusNext,
		focusPrevious,
		focusFirst,
		focusLast,
		handleOpenFocused,
		toggleFocusedSelection,
		extendRangeDown,
		extendRangeUp,
		handleSelectAll,
		hasSelection,
		clearSelection,
		handleDeleteKey,
		toggleDensity,
	]);

	// Derive the MessageListPane listState from the loading/error/empty signals.
	const listState = isLoading
		? "loading"
		: isError
			? "error"
			: threads.length === 0
				? "empty"
				: "ready";

	// Fail-loud (ux.md): surface the real failure under the error headline, and
	// give it a place to go — the same GitHub-issue path the bug-report button
	// uses, so the report carries app version, console errors and the URL.
	const errorMessage = isError ? formatErrorMessage(error) : undefined;
	const handleReportError = useCallback(() => {
		const url = buildGitHubIssueUrl(buildBugReportContext());
		window.open(url, "_blank", "noopener,noreferrer");
	}, []);

	// Single flat section — the mailbox view doesn't group by date.
	const sections = [{ id: "inbox", threads: [] }];

	// Desktop selection toolbar replaces the pane header when any rows are selected.
	const desktopSelectionBar =
		hasSelection && isDesktop ? (
			<SelectionToolbar
				selectedCount={selectedCount}
				onDelete={handleDelete}
				onClearSelection={clearSelection}
				onMarkAsRead={onMarkAsRead ? handleMarkAsRead : undefined}
				onMove={onMoveMessages ? handleMoveSelected : undefined}
				onOrganize={() => setOrganizeOpen(true)}
				isDeleting={isDeleting}
				isMoving={isMoving}
				accountId={accountId}
				currentMailboxId={mailboxId}
				moveDisabledHint={moveDisabledHint}
			/>
		) : undefined;

	// Tier one of the two-tier select-all (issue #92, following Gmail web):
	// every loaded row is checked. Computed against actual membership, not a
	// count comparison, so a transient mismatch (mid-render, before the
	// orphaned-selection effect settles) can't read as "all loaded" by
	// coincidence.
	const allLoadedSelected =
		orderedIds.length > 0 && orderedIds.every((id) => selectedIds.has(id));

	// Tier two: offered only once tier one is complete and search has more
	// matches than are loaded — never a bare "Select all" (requirement 4).
	const escalationAvailable =
		escalationEnabled &&
		hasMore &&
		allLoadedSelected &&
		!isDeleting &&
		!isMoving &&
		escalation.phase.kind === "idle" &&
		!escalation.isDeleting;

	const mobileIsBusy = isDeleting || isMoving || escalation.isDeleting;
	const mobileCount =
		escalation.phase.kind === "escalated"
			? escalation.phase.total
			: selectedCount;

	const mobileStatusLabel = escalation.isDeleting
		? `Deleting ${formatNumber(escalation.deleteProgress?.done ?? 0)} of ${formatNumber(escalation.deleteProgress?.total ?? 0)}…`
		: escalation.phase.kind === "counting"
			? escalation.phase.countSoFar >= 5000
				? `Counting… ${formatNumber(escalation.phase.countSoFar)} so far. This is a big result set.`
				: `Counting… ${formatNumber(escalation.phase.countSoFar)} so far`
			: escalation.phase.kind === "escalated"
				? escalatedStatusLabel(searchPredicate ?? {}, escalation.phase.total)
				: undefined;

	const mobileSelectAll =
		escalation.phase.kind !== "escalated" && orderedIds.length > 0
			? {
					checked: allLoadedSelected,
					indeterminate: selectedCount > 0 && !allLoadedSelected,
					onChange: () => toggleAll(orderedIds),
				}
			: undefined;

	// At most one notice at a time, ranked by how actionable it is: an
	// in-progress counting/escalated state and its own action always wins;
	// otherwise a fresh escalation offer; otherwise a just-finished partial
	// failure's Retry; otherwise the (rare) cross-account move hint.
	const mobileNotice =
		escalation.phase.kind === "counting"
			? {
					tone: "info" as const,
					text: "",
					action: { label: "Stop", onClick: escalation.stop },
				}
			: escalation.phase.kind === "escalated" && !escalation.isDeleting
				? {
						tone: "info" as const,
						text: "",
						action: {
							label: "Clear selection",
							onClick: handleClearEscalation,
						},
					}
				: escalationAvailable
					? {
							tone: "info" as const,
							text: "",
							action: {
								label: escalationActionLabel(searchPredicate ?? {}),
								onClick: escalation.escalate,
							},
						}
					: lastRunSucceeded !== null && selectedCount > 0
						? {
								tone: "danger" as const,
								text: `${formatNumber(lastRunSucceeded)} moved to Trash. ${formatNumber(selectedCount)} couldn't be deleted.`,
								action: {
									label: `Retry ${formatNumber(selectedCount)}`,
									onClick: handleRetryFailed,
								},
							}
						: moveDisabledHint
							? { tone: "warning" as const, text: moveDisabledHint }
							: undefined;

	// Mobile multi-select bar replaces the pane header during selection mode.
	const mobileSelectionBar =
		isMultiSelectMode && !isDesktop ? (
			<SelectionTopBar
				count={mobileCount}
				onCancel={handleMobileCancel}
				onDelete={handleMobileDelete}
				onMarkRead={
					onMarkAsRead && escalation.phase.kind === "idle"
						? handleMarkAsRead
						: undefined
				}
				isBusy={mobileIsBusy}
				isCounting={escalation.phase.kind === "counting"}
				statusLabel={mobileStatusLabel}
				selectAll={mobileSelectAll}
				progress={
					escalation.isDeleting && escalation.deleteProgress
						? {
								value: escalation.deleteProgress.done,
								max: escalation.deleteProgress.total,
								tone: "danger",
							}
						: undefined
				}
				notice={mobileNotice}
				moveSlot={
					escalation.phase.kind === "idle" &&
					!escalation.isDeleting &&
					onMoveMessages &&
					accountId &&
					mailboxId ? (
						<>
							{!moveDisabledHint && (
								<button
									type="button"
									onClick={() => setOrganizeOpen(true)}
									className="min-h-11 min-w-11 inline-flex shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-raised"
									aria-label="Organize similar messages"
								>
									<Sparkles className="size-4" />
								</button>
							)}
							<MoveToTrigger
								accountId={accountId}
								currentMailboxId={mailboxId}
								onMove={isDeleting || isMoving ? () => {} : handleMoveSelected}
								disabledHint={moveDisabledHint}
								label="Move selected messages"
							/>
						</>
					) : undefined
				}
			/>
		) : undefined;

	const activeSelectionBar = desktopSelectionBar ?? mobileSelectionBar;

	// Roving tabindex: exactly one row is in the tab order, so Tab moves focus
	// into the list at the cursor and Shift+Tab moves back out to the side panel
	// instead of walking every row (#43).
	const tabStopMessageId = tabStopId(orderedIds, focusedMessageId);

	// A row focused by Tab or click becomes the cursor, so the keys act on what
	// the browser says is focused.
	const handleRowFocus = useCallback((messageId: string) => {
		cursorMovedByPointerRef.current = true;
		setFocusedMessageId(messageId);
	}, []);

	// The virtualized list body: rows + search header + load-more indicator.
	// Passed to MessageListPane as `listBody` so the kit provides the chrome
	// (pane header, loading / empty / error states, keyboard hints) while we
	// keep the @tanstack/react-virtual row recycling.
	const virtualBody = (
		<>
			{isSearching && searchQuery && (
				<SearchResultsHeader query={searchQuery} count={threads.length} />
			)}
			<div
				ref={parentRef}
				role="listbox"
				aria-multiselectable
				aria-label={listTitle}
				className="flex-1 overflow-y-auto"
			>
				{/* Virtualizer scaffolding — presentational so the listbox sees the
				    rows as its options rather than these positioning wrappers. */}
				<div
					role="presentation"
					className="relative w-full"
					style={{ height: `${virtualizer.getTotalSize()}px` }}
				>
					{virtualizer.getVirtualItems().map((virtualRow) => {
						const thread = threads[virtualRow.index];
						return (
							<div
								key={virtualRow.key}
								role="presentation"
								data-index={virtualRow.index}
								ref={virtualizer.measureElement}
								className={cn(
									"absolute left-0 top-0 w-full border-b border-line",
									// A chunked/escalated delete keeps every targeted row
									// checked, dimmed and untappable for the whole run (issue
									// #92) — the number in the bar and the rows underneath
									// have to agree something is happening, and a row mid
									// -delete must not be openable.
									escalation.isDeleting && "pointer-events-none opacity-50",
								)}
								style={{ transform: `translateY(${virtualRow.start}px)` }}
							>
								<SwipeableMessageRow
									thread={thread}
									mailboxId={mailboxId}
									accountId={accountId}
									isSelected={selectedMessageId === thread.messageId}
									isFocused={focusedMessageId === thread.messageId}
									isTabStop={tabStopMessageId === thread.messageId}
									onFocusRow={handleRowFocus}
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
		</>
	);

	const pendingDeleteCount = pendingDelete
		? pendingDelete.source === "ids"
			? pendingDelete.ids.length
			: pendingDelete.total
		: 0;

	// The predicate case (#109): `pendingDelete.total` is `countMatches`'s
	// frozen page-through, and the delete itself re-pages the same predicate a
	// second, independent time. Mail arriving or leaving between the two can
	// make them differ, so the dialog says "about" instead of promising an
	// exact number it may not honour. A materialized (bounded) selection's
	// count is exact — it's the delete's own input, not an estimate of it.
	const pendingDeleteIsEstimate = pendingDelete?.source === "predicate";

	return (
		<>
			{completionBanner && !isDesktop && (
				<Banner
					tone="success"
					variant="soft"
					className="m-2 rounded-md"
					onDismiss={() => setCompletionBanner(null)}
				>
					{completionBanner}
				</Banner>
			)}
			<MessageListPane
				listTitle={listTitle}
				listMeta={listMeta}
				sections={sections}
				flatList
				listState={listState}
				searchQuery={isSearching ? searchQuery : undefined}
				errorMessage={errorMessage}
				onRetry={onRetry}
				onReportError={handleReportError}
				density={density}
				selectedThreadId={selectedMessageId}
				onSelectThread={(id) =>
					navigate({
						to: "/mail/$mailboxId",
						params: { mailboxId },
						search: (prev) => ({ ...prev, selectedMessageId: id }),
					})
				}
				onSelectBriefCategory={() => undefined}
				isDesktop={isDesktop}
				hideHeader={hideHeader}
				selectionBar={activeSelectionBar}
				listBody={listState === "ready" ? virtualBody : undefined}
			/>
			<ConfirmDialog
				isOpen={pendingDelete !== null}
				title={formatDeleteToTrashTitle(
					pendingDeleteCount,
					pendingDeleteIsEstimate,
				)}
				description={
					pendingDeleteIsEstimate
						? "This count is a snapshot — new mail arriving during the delete won't be included. You can restore what's deleted from Trash later."
						: "You can restore them from Trash later."
				}
				confirmLabel="Move to Trash"
				destructive
				isBusy={isDeleting}
				onConfirm={handleConfirmDelete}
				onCancel={handleCancelDelete}
			/>
			{organizeOpen && accountId && (
				<OrganizeDialog
					open={organizeOpen}
					accountId={accountId}
					mailboxId={mailboxId}
					selectedMessageIds={Array.from(selectedIds)}
					onClose={() => setOrganizeOpen(false)}
				/>
			)}
		</>
	);
};
