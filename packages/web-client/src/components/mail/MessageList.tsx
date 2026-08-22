import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	Banner,
	cn,
	type Density,
	deriveIsMultiSelectMode,
	type MessageListFilter,
	MessageListLoadingMore,
	MessageListPane,
	nextFocusId,
	type SelectionModifiers,
	SelectionTopBar,
	useSelection,
	type Verb,
} from "@remit/ui";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search } from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import { useJunkMailbox } from "@/hooks/useArchiveMailbox";
import { useDeleteOutcome } from "@/hooks/useDeleteOutcome";
import {
	type EscalatedAction,
	type EscalationSearchQuery,
	useEscalatedActions,
} from "@/hooks/useEscalatedActions";
import { useFollowFocusOpen } from "@/hooks/useFollowFocusOpen";
import { useLabelList } from "@/hooks/useLabels";
import { useToggleReadFor } from "@/hooks/useMarkAsRead";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";
import {
	type BulkActionKind,
	bulkActionCompletionText,
	bulkActionProgressLabel,
	bulkActionProgressTone,
	runEndingBanner,
} from "@/lib/bulk-action-copy";
import type { BulkRunOutcome } from "@/lib/bulk-actions";
import {
	describeSearchScope,
	escalatedStatusLabel,
	escalationActionLabel,
} from "@/lib/escalation-label";
import { formatEmailDate } from "@/lib/format";
import { junkDestination } from "@/lib/junk-destination";
import { tabStopId } from "@/lib/list-focus";
import { useListHeaderChrome } from "@/lib/list-header-chrome";
import { listVerbRequest } from "@/lib/list-verb-request";
import { shouldExitSelectionOnNavigate } from "@/lib/selection-mode";
import { useSelectionWizard, useWizardStepValue } from "@/lib/wizard-history";
import type { WizardSelectionMessage } from "@/lib/wizard-selection";
import { useRetainOpenPanels } from "@/routing";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { LabelApplyTrigger } from "./LabelApplyTrigger";
import {
	type EscalatedSelection,
	SelectionWizardHost,
} from "./SelectionWizardHost";
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
	 * Runs a verb over the list's selection by opening the wizard on it, which is
	 * where every selection action is reviewed before it reaches the mail server
	 * (#477 1.4, #508). Returns false when the list did not take the press, so
	 * the pane's own verb can act on the focused row instead — a verb aimed at
	 * one row is not a bulk action and does not walk the wizard. Delete is the
	 * exception with nothing ticked: the list still claims it, to confirm the
	 * move to Trash and then place the cursor on a surviving row.
	 */
	requestVerb: (verb: Verb) => boolean;
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
	 * The active category filter, when the view has one. The empty state needs
	 * it to say it is filtered and how much of the collection the request
	 * reached; without it a narrowed list renders as an empty mailbox, which is
	 * the shape #315's bug hid behind.
	 */
	listFilter?: MessageListFilter;
	/** Name of the collection being listed, e.g. "Inbox", for the empty state. */
	listScopeLabel?: string;
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
		 * Whether the list has a modal open that owns the keyboard — the delete
		 * confirmation, or the wizard. The route suspends the whole triage layer
		 * while it does, so no shortcut can act behind it: a second Delete press
		 * must not reach a delete, and none may start a second flow behind the
		 * screen already asking about one.
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

/**
 * Names what the list is showing. No number: the only figure available here is
 * the length of the loaded pages, and a page length presented as a result total
 * contradicts the completeness the filtered empty state states in the same view
 * (#306). The exact count is #307's.
 */
const SearchResultsHeader = ({ query }: { query: string }) => (
	<div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-surface-sunken/30">
		<Search className="size-4 text-fg-muted" />
		<span className="text-sm text-fg-muted">
			Results for &ldquo;{query}&rdquo;
		</span>
	</div>
);

/**
 * Why Move is withheld from a selection, in the toolbar's own words. Reads each
 * row's own `accountId` — never `accountConfigId`, which every account of one
 * user shares and so can never differ (#456). Pure, so it tests without a DOM.
 */
export const resolveMoveDisabledHint = (
	threads: readonly RemitImapThreadMessageResponse[],
	selectedIds: ReadonlySet<string>,
): string | undefined => {
	if (selectedIds.size === 0) return undefined;
	const accountIds = new Set<string>();
	for (const thread of threads) {
		if (!selectedIds.has(thread.messageId)) continue;
		if (thread.accountId) accountIds.add(thread.accountId);
	}
	if (accountIds.size > 1) {
		return "Move only works within one account — clear selection or pick messages from a single account";
	}
	return undefined;
};

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
	isDeleting = false,
	isMoving = false,
	onLoadMore,
	hasMore = false,
	isLoadingMore = false,
	accountId,
	listTitle,
	listMeta,
	listFilter,
	listScopeLabel,
	onTriageContextChange,
	commandsRef,
	hideHeader = false,
}: MessageListProps) => {
	const parentRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();
	const retainPanels = useRetainOpenPanels();
	const isDesktop = useIsDesktop();
	const wizard = useSelectionWizard();
	const { verb: wizardVerb, start: startWizard, startFromSearch } = wizard;
	const wizardStep = useWizardStepValue();
	const isSearching = !!searchQuery?.trim();
	const listHeaderChrome = useListHeaderChrome();
	const { labels } = useLabelList(accountId);
	const { pushError } = useErrorBanners();

	// Roving focus cursor (#429): the keyboard "where am I" pointer, distinct
	// from the open thread (the message segment in the path). j/k move this
	// cursor; Enter opens the focused row → sets selected, and on desktop the
	// reading pane follows the cursor of its own accord (see the follow-focus
	// wiring below). It seeds from the open thread so opening a message also
	// focuses its row, and click-to-open keeps working unchanged (the route
	// still navigates).
	const [focusedMessageId, setFocusedId] = useState<string | undefined>(
		selectedMessageId,
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

	// The Junk quick action moves the selection to the account's appointed Junk
	// mailbox — the message-flags API has no `$Junk` field, so "junk" is a move.
	const { junkMailboxId } = useJunkMailbox(accountId);
	const junkDestinationId = junkDestination(junkMailboxId, mailboxId);

	// Deleting inside Trash is an expunge on the mail server, not a move, so the
	// confirmation has to ask that question instead of "move to Trash?" (#845).
	// Every row here is filed in the open mailbox, so that one folder is the
	// whole set the delete acts on.
	const deleteScope = useMemo(
		() => [{ accountId, mailboxId }],
		[accountId, mailboxId],
	);
	const {
		outcome: deleteOutcome,
		trashIsUnconfirmed,
		staleFolderLabel,
	} = useDeleteOutcome(deleteScope);

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

	// The selection count is the only source of truth for whether the list is
	// in multi-select mode (#115). A separate flag needs an effect to reconcile
	// it back to the count, and across that render the two disagree.
	const isMultiSelectMode = deriveIsMultiSelectMode(selectedCount, isDesktop);

	// The one delete that does not walk the wizard: the Delete key with nothing
	// ticked, which acts on the row under the cursor. The ids are snapshotted at
	// request time so a cursor move behind the dialog cannot retarget it. Every
	// delete over a selection — ticked or escalated — goes through the wizard's
	// review screen instead.
	const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);

	// Search-scoped escalated selection + chunked bulk actions (issues #92, #212):
	// available on both surfaces, and only while search has more matches than
	// are loaded. `orderedIds` below feeds `allLoadedSelected`; declared after
	// this hook so its callback deps stay simple — see the
	// `orderedIds`/`handleRowSelect` block.
	const escalationEnabled = isSearching && !!searchPredicate;
	const predicateKey = `${mailboxId}|${JSON.stringify(searchPredicate ?? {})}`;
	const escalation = useEscalatedActions({
		mailboxId,
		accountId,
		enabled: escalationEnabled,
		predicateKey,
		searchQuery: searchPredicate ?? {},
	});

	// How a run ended, for the user who is no longer looking at the run screen.
	// Closing the wizard mid-run is a movement the screen invites, and the run
	// keeps going past it — so the list is what states the ending, whether the
	// run covered everything or stopped short of it. The wizard calls this only
	// once the user has left it, so an ending is never said twice.
	const reportRunOutcome = useCallback(
		(kind: BulkActionKind, matched: number, outcome: BulkRunOutcome) => {
			const banner = runEndingBanner(kind, matched, outcome, deleteOutcome);
			// A run stopped by a thrown batch is already banner-ed where it threw.
			if (!banner) return;
			pushError(banner);
		},
		[pushError, deleteOutcome],
	);

	// The one way selection mode ends (#115): cancel, a completed delete or
	// move, a plain click that collapses a range, switching mailboxes, the back
	// gesture. Nothing calls the selection hook's `clearSelection` directly, so
	// an escalated selection can never survive the exit as a stale phase.
	const escalationPhaseKind = escalation.phase.kind;
	const clearEscalation = escalation.clear;
	const exitSelection = useCallback(() => {
		if (escalationPhaseKind === "escalated") clearEscalation();
		clearSelection();
	}, [clearSelection, clearEscalation, escalationPhaseKind]);

	// Transient, manually-dismissed success banner shown in place of the
	// selection bar once a single-row delete lands on mobile, where the list
	// stays up and nothing else says it happened (#202). Honest about IMAP's
	// async catch-up rather than claiming a finality the bulk endpoint's
	// response doesn't have.
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
			setKeyboardFocusedMessageId(thread.messageId);
			setFocusedId(thread.messageId);
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

	// The checked rows as the wizard reads them: the sample it shows under every
	// screen that names a match, and the senders its widen falls back to on a
	// deployment with no vector pipeline. Read off the already-loaded thread rows,
	// so no extra round-trip.
	const wizardSelection = useMemo<WizardSelectionMessage[]>(() => {
		const rows: WizardSelectionMessage[] = [];
		for (const thread of threads) {
			if (!selectedIds.has(thread.messageId)) continue;
			rows.push({
				id: thread.messageId,
				sender: thread.fromName ?? thread.fromEmail ?? "Unknown",
				email: thread.fromEmail ?? "",
				subject: thread.subject ?? "(No subject)",
				date: formatEmailDate(thread.sentDate),
				accountId,
			});
		}
		return rows;
	}, [threads, selectedIds, accountId]);
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

	// Open the delete confirmation for the row under the cursor. A delete over a
	// selection is a bulk action and walks the wizard instead, so this is the one
	// delete the dialog still covers.
	const requestDelete = useCallback(
		(ids: string[]) => {
			if (!onDeleteMessages || ids.length === 0) return;
			focusBeforeConfirmRef.current = focusedMessageId ?? null;
			setPendingDelete(ids);
		},
		[onDeleteMessages, focusedMessageId],
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
			// shift-click. It is building a range, not reading, so the reading pane
			// stays on whatever is open rather than chasing the range's edge.
			pendingDomFocusRef.current = target;
			cursorMovedByPointerRef.current = false;
			setKeyboardFocusedMessageId(undefined);
			setFocusedId(target);
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

	// A keyboard verb, routed by `listVerbRequest` — the same routing the bar
	// renders from, so a verb the bar withholds is not still reachable by
	// shortcut. Over a selection every verb opens the wizard (#477 1.4), whatever
	// the selection is: the ticked rows, a selection spanning accounts — the
	// wizard is where that restriction is stated, on the step that needs one
	// account (#477 5.5) — or the predicate the list escalated to, which the
	// wizard names on its match step and counts on its review screen before
	// anything is sent (#508).
	const requestVerb = useCallback(
		(verb: Verb): boolean => {
			const request = listVerbRequest({
				verb,
				confirmingDelete: pendingDelete !== null,
				hasSelection,
				junkMailboxId,
				currentMailboxId: mailboxId,
				deletableMessageId: onDeleteMessages ? focusedMessageId : undefined,
			});
			if (request.kind === "openWizard") {
				startWizard(verb);
				return true;
			}
			if (request.kind === "confirmDelete") {
				requestDelete([request.messageId]);
				return true;
			}
			// A shortcut that does nothing at all is indistinguishable from one that
			// is broken, so a verb this mailbox cannot take says why on the press.
			if (request.kind === "unavailable") {
				pushError({ severity: "warning", title: request.reason });
				return true;
			}
			return request.kind === "withheld";
		},
		[
			pendingDelete,
			onDeleteMessages,
			hasSelection,
			junkMailboxId,
			mailboxId,
			startWizard,
			focusedMessageId,
			requestDelete,
			pushError,
		],
	);

	// Opening a row is a navigation to the conversation under this folder. Every
	// row the list renders names its thread, which is what the reading pane
	// fetches by — a row the list no longer holds cannot be opened from here.
	const openRow = useCallback(
		(messageId: string, options?: { replace?: boolean }) => {
			const threadId = threads.find(
				(thread) => thread.messageId === messageId,
			)?.threadId;
			if (!threadId) return;
			navigate({
				to: "/mail/$mailboxId/$threadId/$messageId",
				params: { mailboxId, threadId, messageId },
				search: (prev) => prev,
				hash: retainPanels,
				replace: options?.replace,
			});
		},
		[navigate, retainPanels, mailboxId, threads],
	);

	// Enter: open the focused row in the reading pane. This is the focus→open
	// transition of the 2-state model.
	const handleOpenFocused = useCallback(() => {
		if (!focusedMessageId) return;
		openRow(focusedMessageId);
	}, [focusedMessageId, openRow]);

	// The reading pane follows the cursor on desktop: j/k load the row they land
	// on, without the user having to press Enter for every message. It replaces
	// the history entry rather than pushing one — a preview the cursor produced
	// is not a navigation the user asked for, and Back should still leave the
	// mailbox instead of walking the cursor's path back up the list.
	//
	// Suspended while rows are selected: the cursor is then picking out a set,
	// and the selection toolbar — not a message — is what the user is looking at.
	// Suspended off desktop too, where the reading pane replaces the list
	// entirely, so following the cursor would throw the user off the list.
	const followFocusOpen = useCallback(
		(messageId: string) => openRow(messageId, { replace: true }),
		[openRow],
	);
	useFollowFocusOpen({
		keyboardFocusedMessageId,
		openMessageId: selectedMessageId,
		enabled: isDesktop && selectedCount === 0,
		open: followFocusOpen,
	});

	// The escalated selection as the wizard walks it (#508): the words the bar
	// already names the predicate with, the count it was escalated to, and the
	// chunked runner that re-resolves it.
	const escalatedSelection: EscalatedSelection | undefined =
		escalation.phase.kind === "escalated"
			? {
					scope: describeSearchScope(searchPredicate ?? {}),
					total: escalation.phase.total,
					searchQuery: searchPredicate ?? {},
					run: (action: EscalatedAction) => escalation.runAction(action),
					stop: escalation.stop,
				}
			: undefined;

	// Confirm handler: run the actual delete, then clear selection and move
	// focus to a sensible neighbor (the row after the first deleted one).
	const handleConfirmDelete = useCallback(
		(ids: string[]) => {
			if (ids.length === 0) {
				setPendingDelete(null);
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
			exitSelection();
			focusBeforeConfirmRef.current = null;
			setPendingDelete(null);

			if (nextFocus !== undefined) {
				// Same hand-back as cancelling, aimed at the surviving neighbour
				// instead: confirming also closes a dialog that held DOM focus.
				pendingDomFocusRef.current = nextFocus;
				cursorMovedByPointerRef.current = false;
				setFocusedMessageId(nextFocus);
				// Desktop is two-pane: opening the neighbour fills the reading pane
				// beside the list. On a single-pane mobile layout the same navigation
				// replaces the list with a full-screen message, so a bulk delete looks
				// like it opened a random neighbour instead of removing the rows (#202).
				// Mobile keeps the cursor move but stays on the list.
				if (isDesktop) {
					openRow(nextFocus, { replace: true });
				}
			}

			// Mobile keeps the list up, so it needs its own signal the delete landed
			// (#202). On desktop the rows leaving the list beside the reading pane is
			// signal enough.
			if (!isDesktop) {
				setCompletionBanner(
					bulkActionCompletionText("delete", ids.length, deleteOutcome),
				);
			}
		},
		[
			threads,
			onDeleteMessages,
			exitSelection,
			openRow,
			isDesktop,
			setFocusedMessageId,
			deleteOutcome,
		],
	);

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
	}, [setFocusedMessageId]);

	// `MessageList` re-renders on every virtualizer scroll tick. Memoize the
	// guard so we only walk the selected slice when selection or thread
	// identity actually changes.
	const moveDisabledHint = useMemo(
		() => resolveMoveDisabledHint(threads, selectedIds),
		[selectedIds, threads],
	);

	// Organize builds a rule out of clauses, and a search predicate is not a set
	// of clauses — its facets have no `ClauseField`. Over an escalated selection
	// the verb therefore opens the wizard through the search entry instead, on the
	// property step with the query already converted (#477 1.8): the same door the
	// make-filter affordance opens, which the bar hides while rows are ticked. The
	// control stays pressable and lands somewhere that works (#477 1.7) rather
	// than disappearing the moment a selection escalates.
	const organizeSelection = useCallback(() => {
		if (escalatedSelection) {
			startFromSearch();
			return;
		}
		startWizard("organize");
	}, [escalatedSelection, startFromSearch, startWizard]);

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

	// Mobile: a long press enters multi-select mode by starting a selection —
	// the mode follows from the count, there is no flag to set.
	const handleLongPress = useCallback(
		(messageId: string) => {
			if (!isDesktop) {
				select(messageId);
			}
		},
		[isDesktop, select],
	);

	// The selection bar's X (both surfaces): means "stop what's happening"
	// throughout, not just "cancel selection" (issue #92 — the review flagged
	// the X reading as ambiguous once a run is going). Counting and a chunked
	// run both stop at the next page boundary; an escalated-but-idle selection
	// drops back to bounded on the way out, same as tapping "Clear selection".
	const handleSelectionCancel = useCallback(() => {
		if (escalation.isRunning || escalation.phase.kind === "counting") {
			escalation.stop();
			return;
		}
		exitSelection();
	}, [escalation, exitSelection]);

	// The escalation notice's "Clear selection" action: drop back to the
	// bounded (all-loaded) selection without touching selection mode itself.
	const handleClearEscalation = useCallback(() => {
		escalation.clear();
	}, [escalation]);

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
	}, [selectedMessageId, setFocusedMessageId]);

	// Keep the focus cursor valid as the thread list changes (after delete /
	// move / refetch). If the focused row vanished, snap to the nearest
	// surviving row so j/k never dead-ends.
	useEffect(() => {
		if (!focusedMessageId) return;
		if (threads.some((t) => t.messageId === focusedMessageId)) return;
		setFocusedMessageId(threads[0]?.messageId);
	}, [threads, focusedMessageId, setFocusedMessageId]);

	// Bridge the roving cursor + selection up to the route's global keyboard
	// dispatcher (#429) so the action verbs can target the focused row, or the
	// selection when one exists.
	useEffect(() => {
		onTriageContextChange?.({
			focusedMessageId,
			selectedIds: Array.from(selectedIds),
			hasList: commandsAvailable,
			blocksKeyboard: confirmOpen || wizard.isOpen,
		});
	}, [
		focusedMessageId,
		selectedIds,
		commandsAvailable,
		confirmOpen,
		wizard.isOpen,
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
	// rows on an ordinary refresh.
	// Skipped while an escalated run is active: `selectedIds` there is a stale
	// loaded-rows snapshot from the moment escalation started (the real
	// selection is the predicate, D2), not something a background refetch
	// reshuffling `threads` should be allowed to narrow out from under a count
	// or a run in progress — that would silently exit selection mode mid-run.
	useEffect(() => {
		if (escalation.phase.kind !== "idle" || escalation.isRunning) return;
		intersectWith(threads.map((t) => t.messageId));
	}, [threads, intersectWith, escalation.phase, escalation.isRunning]);

	// Switching mailboxes exits selection outright, instead of leaving it to the
	// intersect effect above to empty the set by coincidence — a different
	// mailbox's threads happen to share none of the old ids.
	const previousMailboxIdRef = useRef(mailboxId);
	useEffect(() => {
		if (previousMailboxIdRef.current === mailboxId) return;
		previousMailboxIdRef.current = mailboxId;
		exitSelection();
	}, [mailboxId, exitSelection]);

	// The back gesture (Android's back button, the browser's back) leaves
	// selection mode rather than the route. Only `BACK` is intercepted, so a
	// navigation the app itself starts — opening a message, switching mailboxes
	// — is never blocked, and the blocker is off entirely with nothing selected.
	useBlocker({
		shouldBlockFn: ({ action }) => {
			if (!shouldExitSelectionOnNavigate(action, hasSelection, wizardStep)) {
				return false;
			}
			exitSelection();
			return true;
		},
		enableBeforeUnload: false,
		disabled: !hasSelection || wizardStep !== undefined,
	});

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
				exitSelection();
				return true;
			},
			requestVerb,
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
		exitSelection,
		requestVerb,
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
		!escalation.isRunning;

	// The escalation-derived surface state — viewport-independent, fed to both
	// the mobile sheet and the desktop toolbar so the two never diverge (#212).
	const selectionIsBusy = isDeleting || isMoving || escalation.isRunning;
	const selectionCount =
		escalation.phase.kind === "escalated"
			? escalation.phase.total
			: selectedCount;

	// A run reports on the bar from the moment it starts, not from its first
	// finished batch: the wizard invites the user back here mid-run, and a run
	// with no reading yet is still a run — it is counted against what it was
	// started with until it has covered something of its own.
	const selectionStatusLabel = escalation.runningAction
		? bulkActionProgressLabel(
				escalation.runningAction.kind,
				escalation.progress?.done ?? 0,
				escalation.progress?.total ?? selectionCount,
			)
		: escalation.phase.kind === "counting"
			? "Counting matches…"
			: escalation.phase.kind === "escalated"
				? escalatedStatusLabel(searchPredicate ?? {}, escalation.phase.total)
				: undefined;

	// The select-all-loaded control. The mobile sheet carries it for any bounded
	// selection; the desktop toolbar only wires it while searching (below), where
	// escalating past the loaded page is possible.
	const selectionSelectAll =
		escalation.phase.kind !== "escalated" && orderedIds.length > 0
			? {
					checked: allLoadedSelected,
					indeterminate: selectedCount > 0 && !allLoadedSelected,
					onChange: () => toggleAll(orderedIds),
				}
			: undefined;

	const selectionProgress = escalation.runningAction
		? {
				value: escalation.progress?.done ?? 0,
				max: escalation.progress?.total ?? selectionCount,
				tone: bulkActionProgressTone(escalation.runningAction.kind),
			}
		: undefined;

	// At most one escalation notice at a time, ranked by how actionable it is:
	// an in-progress counting/escalated state and its own action always wins;
	// otherwise a fresh escalation offer. The (rare) cross-account move hint is
	// layered on behind them below.
	const escalationNotice =
		escalation.phase.kind === "counting"
			? {
					tone: "info" as const,
					text: "",
					action: { label: "Stop", onClick: escalation.stop },
				}
			: escalation.phase.kind === "escalated" && !escalation.isRunning
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
					: undefined;

	// The bar shows one notice at a time, so the cross-account move restriction
	// rides in behind the escalation states.
	const selectionNotice =
		escalationNotice ??
		(moveDisabledHint
			? { tone: "warning" as const, text: moveDisabledHint }
			: undefined);

	// One selection surface at every width, always mounted: it is the list
	// header. With nothing ticked it names the mailbox and carries the header's
	// own chrome; from the first ticked row the count and the verbs take that
	// title's place, and the escalation states (issue #212) — the offer,
	// counting, the escalated predicate, a chunked run's progress — ride on the
	// same bar rather than a second one.
	const activeSelectionBar = (
		<SelectionTopBar
			title={listHeaderChrome.title || listTitle}
			navSlot={listHeaderChrome.navSlot}
			titleMeta={listHeaderChrome.titleMeta}
			searchSlot={listHeaderChrome.searchSlot}
			searchField={listHeaderChrome.searchField}
			idleSlot={listHeaderChrome.makeFilterSlot}
			count={selectionCount}
			onCancel={handleSelectionCancel}
			onDelete={() => startWizard("delete")}
			onMove={() => startWizard("move")}
			onOrganize={organizeSelection}
			onJunk={junkDestinationId ? () => startWizard("junk") : undefined}
			onMarkRead={() => startWizard("markRead")}
			overflowSlot={
				accountId && mailboxId && selectedCount > 0 && labels.length > 0 ? (
					<LabelApplyTrigger
						accountId={accountId}
						mailboxId={mailboxId}
						messageIds={Array.from(selectedIds)}
					/>
				) : undefined
			}
			isBusy={selectionIsBusy}
			isCounting={escalation.phase.kind === "counting"}
			selectAll={selectionSelectAll}
			statusLabel={selectionStatusLabel}
			progress={selectionProgress}
			notice={selectionNotice}
		/>
	);

	// Roving tabindex: exactly one row is in the tab order, so Tab moves focus
	// into the list at the cursor and Shift+Tab moves back out to the side panel
	// instead of walking every row (#43).
	const tabStopMessageId = tabStopId(orderedIds, focusedMessageId);

	// A row focused by Tab or click becomes the cursor, so the keys act on what
	// the browser says is focused.
	const handleRowFocus = useCallback(
		(messageId: string) => {
			cursorMovedByPointerRef.current = true;
			setFocusedMessageId(messageId);
		},
		[setFocusedMessageId],
	);

	// The virtualized list body: rows + search header + load-more indicator.
	// Passed to MessageListPane as `listBody` so the kit provides the chrome
	// (pane header, loading / empty / error states, keyboard hints) while we
	// keep the @tanstack/react-virtual row recycling.
	const virtualBody = (
		<>
			{isSearching && searchQuery && (
				<SearchResultsHeader query={searchQuery} />
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
									escalation.isRunning && "pointer-events-none opacity-50",
								)}
								style={{ transform: `translateY(${virtualRow.start}px)` }}
							>
								<SwipeableMessageRow
									thread={thread}
									mailboxId={mailboxId}
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
				{isLoadingMore && <MessageListLoadingMore />}
			</div>
		</>
	);

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
				// The results panel is a body, not a list state: it stands in for the
				// rows and must not fall behind a skeleton while the query re-keys.
				listState={listHeaderChrome.searchResults ? "ready" : listState}
				searchQuery={isSearching ? searchQuery : undefined}
				listFilter={listFilter}
				listScopeLabel={listScopeLabel}
				errorMessage={errorMessage}
				onRetry={onRetry}
				onReportError={handleReportError}
				density={density}
				selectedThreadId={selectedMessageId}
				onSelectThread={(id) => openRow(id)}
				isDesktop={isDesktop}
				hideHeader={hideHeader}
				selectionBar={activeSelectionBar}
				listBody={
					listHeaderChrome.searchResults ??
					(listState === "ready" ? virtualBody : undefined)
				}
			/>
			<DeleteConfirmDialog
				isOpen={pendingDelete !== null}
				messageIds={pendingDelete ?? []}
				outcome={deleteOutcome}
				accountId={accountId}
				// Every row here is filed in the open mailbox, so on an expunge that
				// mailbox is the Trash the copy has to name.
				trashFolderLabel={listTitle}
				staleFolderLabel={staleFolderLabel}
				trashIsUnconfirmed={trashIsUnconfirmed}
				isDeleting={isDeleting}
				onConfirm={handleConfirmDelete}
				onCancel={handleCancelDelete}
			/>
			<SelectionWizardHost
				verb={wizardVerb}
				accountId={accountId}
				mailboxId={mailboxId}
				selection={wizardSelection}
				selectionRestriction={moveDisabledHint ? "spansAccounts" : undefined}
				escalated={escalatedSelection}
				escalatedProgress={escalation.progress}
				onFinished={exitSelection}
				onRunEnded={reportRunOutcome}
			/>
		</>
	);
};
