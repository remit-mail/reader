/**
 * MailboxPane — compound component for the mailbox view.
 *
 * Encapsulates all state, hooks, and rendering for the /mail/$mailboxId view.
 * The list layout route mounts `<MailboxPane>` around the shell and passes the
 * sub-views into slots, with the reading pane as the `Outlet`:
 *
 *   <MailboxPane mailboxId={...} thread={useOpenThreadPath()}>
 *     <MailShell
 *       list={<MailboxPane.List />}
 *       reading={<Outlet />}
 *       intelligence={<MailboxPane.Intelligence />}
 *     />
 *   </MailboxPane>
 *
 * On phone, use `<MailboxPane.Phone />` instead of the slot sub-views.
 */
import {
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	threadOperationsListThreads,
	threadOperationsSearchThreads,
} from "@remit/api-http-client/sdk.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	inboxFilterConfig,
	type MessageListFilter,
	ReadingPaneEmpty,
	RefreshButton,
	type RescueCandidate,
	type SearchResult,
} from "@remit/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
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
import { ConversationView } from "@/components/mail/ConversationView";
import { DraftsView } from "@/components/mail/DraftsView";
import { EmptyTrashBar } from "@/components/mail/EmptyTrashBar";
import { IntelligenceDrawer } from "@/components/mail/IntelligenceDrawer";
import { IntelligencePane } from "@/components/mail/IntelligencePane";
import {
	MessageList,
	type MessageListCommands,
} from "@/components/mail/MessageList";
import { MessageToolbar } from "@/components/mail/MessageToolbar";
import { PullToRefresh } from "@/components/mail/PullToRefresh";
import { SpamRescue } from "@/components/mail/SpamRescue";
import {
	useArchiveMailbox,
	useDraftsMailbox,
	useJunkMailbox,
	useTrashByAccount,
	useTrashMailbox,
} from "@/hooks/useArchiveMailbox";
import {
	useCurrentMailboxMessageCount,
	useCurrentMailboxName,
	useCurrentMailboxUnseenCount,
} from "@/hooks/useCurrentMailboxName";
import {
	dropDeletedThreads,
	useDeleteMessages,
} from "@/hooks/useDeleteMessages";
import { useEmptyTrash } from "@/hooks/useEmptyTrash";
import type { EscalationSearchQuery } from "@/hooks/useEscalatedActions";
import { useIntelligenceData } from "@/hooks/useIntelligenceData";
import { useIntelligenceDrawer } from "@/hooks/useIntelligenceDrawer";
import {
	type IntelligenceCommands,
	useIntelligenceSurface,
	usePublishIntelligenceCommands,
} from "@/hooks/useIntelligenceSurface";
import { useLayoutTier } from "@/hooks/useLayoutTier";
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import { useToggleReadFor } from "@/hooks/useMarkAsRead";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useRefreshControl } from "@/hooks/useRefreshControl";
import { useRescueCandidates } from "@/hooks/useRescueCandidates";
import { useSearchTokenContext } from "@/hooks/useSearchTokenContext";
import { useSemanticSearch } from "@/hooks/useSemanticSearch";
import { useThreadActions } from "@/hooks/useThreadActions";
import { useThreadMessageIds } from "@/hooks/useThreadMessageIds";
import { useThreadRow } from "@/hooks/useThreadRow";
import { useToggleStar } from "@/hooks/useToggleStar";
import { useTriageContext, useTriageLayer } from "@/hooks/useTriageLayer";
import { useUpdateAddressFlags } from "@/hooks/useUpdateAddressFlags";
import type { ConversationTarget } from "@/lib/conversation-target";
import { dedupeThreadMessages } from "@/lib/dedupe-thread-messages";
import {
	filterReach,
	hasInboxFilter,
	type InboxFilterCriteria,
	type InboxFilterParams,
	inboxFilterParams,
	sameInboxFilter,
} from "@/lib/inbox-filters";
import { junkDestination } from "@/lib/junk-destination";
import { useMailContext } from "@/lib/mail-context";
import { useMailFreshness } from "@/lib/mail-freshness";
import { isRescueCandidate } from "@/lib/rescue-candidates";
import { recordRescueSentToJunk } from "@/lib/rescue-telemetry";
import { normalizeSearchQuery } from "@/lib/search-query";
import {
	relatedSearchResults,
	threadToSearchResult,
} from "@/lib/search-result";
import { parseSearchTokens } from "@/lib/search-tokens";
import { useTelemetry } from "@/lib/telemetry-context";
import {
	applyResidualTokens,
	threadSearchTokens,
} from "@/lib/thread-search-tokens";
import {
	type OpenThreadPath,
	type OpenThreadTarget,
	type ReplyMode,
	replyToThread,
	useCloseThread,
	useGoToSection,
	useIsComposing,
	useIsReplying,
	useOpenCompose,
	useOpenReply,
	useOpenThread,
} from "@/routing";
import { MailViewChrome } from "./MailViewChrome";

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

interface MailboxPaneContextValue {
	mailboxId: string;
	/** The row the reader pointed at, which is the one the list highlights. */
	selectedMessageId: string | undefined;
	selectedThread: RemitImapThreadMessageResponse | undefined;
	/** The conversation the pane shows, or none when the address names no thread. */
	conversation: ConversationTarget | undefined;
	/** Opens a conversation in this folder's reading pane. */
	onOpenThread: (target: OpenThreadTarget) => void;
	threads: RemitImapThreadMessageResponse[];
	isLoading: boolean;
	isError: boolean;
	error: unknown;
	mailboxAccountId: string | undefined;
	mailboxAccountLoading: boolean;
	mailboxName: string | null;
	unreadCount: number;
	isDraftsMailbox: boolean;
	// Rescue-from-Spam: true on the account's Junk/Spam folder, with the
	// suspected-safe messages `useRescueCandidates` fetched. Drives the rescue
	// banner + flow above the spam list.
	isSpamFolder: boolean;
	rescueCandidates: RescueCandidate[];
	// Inbox filter (category + Unread/Flagged/Attachment). The chips are search
	// parameters: the server returns the filtered page, so `threads` is the
	// answer to the active predicate over the whole mailbox rather than a
	// narrowed copy of the loaded window (#306).
	filterCategory: string;
	filterAttributes: ReadonlySet<string>;
	onSelectFilterCategory: (id: string) => void;
	onToggleFilterAttribute: (id: string) => void;
	onClearFilters: () => void;
	/**
	 * The active category filter as the empty state renders it — its label, the
	 * way out of it, and how much of the mailbox the request reached. Undefined
	 * when no category is selected.
	 */
	listFilter: MessageListFilter | undefined;
	onToggleIntelligence: () => void;
	/**
	 * Where the mounted reading surface publishes the intelligence commands the
	 * keyboard layer drives. The rail's width gate is the shell's own
	 * measurement and this provider sits above the shell, so the surface that is
	 * mounted answers for its own tier rather than this one guessing.
	 */
	intelligenceRef: RefObject<IntelligenceCommands | null>;
	/**
	 * Deselects the open message when it's the one a mutation just removed
	 * from this mailbox's list — wired into every mutation that can take the
	 * open message out of view (delete, move, report-spam/undo), so the
	 * reading pane and intelligence panel never keep rendering a message
	 * that's left the list they're watching.
	 */
	handleDeselectIfRemoved: (removedIds: string[]) => void;
	/**
	 * The active search predicate — undefined when not searching. Threaded
	 * down so the mobile list can re-issue the identical filter while paging
	 * past what's loaded (escalated select-all, issue #92); the display string
	 * on `searchQuery`/`useMailContext` only carries what's shown in the
	 * header, not enough to reproduce the query server-side.
	 */
	searchPredicate: EscalationSearchQuery | undefined;
	// List actions
	onDeleteMessages: (ids: string[]) => void;
	onMoveMessages: (ids: string[], dest: string) => void;
	isDeleting: boolean;
	isMoving: boolean;
	onLoadMore: () => void;
	hasMore: boolean;
	isLoadingMore: boolean;
	onTriageContextChange: (ctx: {
		focusedMessageId: string | undefined;
		selectedIds: string[];
		hasList: boolean;
		blocksKeyboard: boolean;
	}) => void;
	/** Where the list publishes the commands the keyboard layer drives. */
	listCommandsRef: RefObject<MessageListCommands | null>;
	onRetry: () => void;
	// Toolbar / reading pane actions
	/**
	 * Answer the open conversation. Absent when none is open, which is what the
	 * toolbar turns into its own explanation.
	 */
	onReply: ((mode: ReplyMode) => void) | undefined;
	onToolbarDelete: () => void;
	onToolbarStar: () => void;
	/** Whether the open message is starred, as the conversation reports it. */
	isStarred: boolean | undefined;
	onToolbarMove: (destMailboxId: string) => void;
	// Phone actions
	onBack: () => void;
	/** The rows either side of the open one — the phone's swipe gestures. */
	nextThread: OpenThreadTarget | undefined;
	previousThread: OpenThreadTarget | undefined;
}

/** The server's own default page size (`DEFAULT_THREADS_PAGE_SIZE`), sent so the
 *  filtered path pages like the unfiltered one. */
const THREADS_PAGE_SIZE = 50;

/** Chip id → the label the empty state names the filter by. `all` is absent:
 *  it is how the category is cleared, not a category. */
const CATEGORY_LABELS = new Map(
	inboxFilterConfig()
		.categories.filter((category) => category.id !== "all")
		.map((category) => [category.id, category.label]),
);

const MailboxPaneCtx = createContext<MailboxPaneContextValue | null>(null);

function useMailboxPane(): MailboxPaneContextValue {
	const ctx = useContext(MailboxPaneCtx);
	if (!ctx) throw new Error("MailboxPane.* must be used inside <MailboxPane>");
	return ctx;
}

/* ------------------------------------------------------------------ */
/* Provider                                                             */
/* ------------------------------------------------------------------ */

interface MailboxPaneProps {
	mailboxId: string;
	/** The open conversation, as the address states it. */
	thread: OpenThreadPath | undefined;
	children: ReactNode;
}

function MailboxPaneProvider({
	mailboxId,
	thread,
	children,
}: MailboxPaneProps) {
	const openThread = useOpenThread();
	const closeThread = useCloseThread();
	const goToSection = useGoToSection();
	const threadId = thread?.threadId;
	const pointedAtMessageId = thread?.messageId;
	const telemetry = useTelemetry();
	const { accounts, searchQuery, onToggleIntelligence } = useMailContext();
	const tokenContext = useSearchTokenContext();

	const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
	const hasSearchQuery = normalizedSearchQuery.length > 0;
	// Filter tokens narrow this literal search to the params
	// `threadOperationsSearchThreads` supports (`from`, `subject`, `category`,
	// `unread`, `starred`, `attachments`). What the endpoint has no parameter for
	// — `before:`/`after:`/`account:`, and any second value for a parameter that
	// takes one — comes back as residue and is applied over the returned rows
	// below, because a token neither sent nor applied silently widens the result
	// to mail the user asked to exclude. `in:` never reaches here at all: this
	// view is scoped to one mailbox by its route, so `useSearchTokenContext` does
	// not resolve the term and it stays free text.
	const { freeText, tokens: searchTokens } = parseSearchTokens(
		normalizedSearchQuery,
		tokenContext,
	);

	const [filterCategory, setFilterCategory] = useState("all");
	const [filterAttributes, setFilterAttributes] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const filterCriteria: InboxFilterCriteria = useMemo(
		() => ({ category: filterCategory, attributes: filterAttributes }),
		[filterCategory, filterAttributes],
	);
	const filterParams = useMemo(
		() => inboxFilterParams(filterCriteria),
		[filterCriteria],
	);

	// The chips are query parameters, not a browser-side pass over the loaded
	// pages: a category whose mail sits below the newest page is why the filter
	// showed an empty inbox at all (#306). `listThreads` takes no filters, so any
	// active chip routes the listing through `searchThreads` — one predicate, one
	// query key, so the key and the branch below cannot diverge.
	const hasServerFilter = hasSearchQuery || hasInboxFilter(filterCriteria);
	// The chips are spread last: where a chip and a token set the same parameter
	// the visible control decides, and the token drops to the residue.
	const { params: tokenParams, residual: residualTokens } = threadSearchTokens(
		searchTokens,
		filterParams,
	);
	const searchThreadsQuery = {
		order: "desc" as const,
		// Explicit: an unspecified limit clamps to THREAD_SEARCH_MAX_LIMIT (500),
		// so switching paths without it multiplies the page size by ten.
		limit: THREADS_PAGE_SIZE,
		...(freeText ? { query: freeText } : {}),
		...tokenParams,
		...filterParams,
	};
	// What the request actually narrows by, whoever set it. `placeholderData`
	// keeps the previous rows only under the same predicate, and a token
	// narrowing the list is as much that predicate as a chip is.
	const activeFilterParams: InboxFilterParams = {
		category: searchThreadsQuery.category,
		unread: searchThreadsQuery.unread,
		starred: searchThreadsQuery.starred,
		attachments: searchThreadsQuery.attachments,
	};

	const queryKey = hasServerFilter
		? threadOperationsSearchThreadsQueryKey({
				path: { mailboxId },
				query: searchThreadsQuery,
			})
		: threadOperationsListThreadsQueryKey({
				path: { mailboxId },
				query: { order: "desc" },
			});

	const {
		data: threadsData,
		isLoading,
		isError,
		error,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useInfiniteQuery({
		queryKey,
		queryFn: async ({ pageParam }) => {
			if (hasServerFilter) {
				const { data } = await threadOperationsSearchThreads({
					path: { mailboxId },
					query: {
						...searchThreadsQuery,
						continuationToken: pageParam,
					},
					throwOnError: true,
				});
				return data;
			}
			const { data } = await threadOperationsListThreads({
				path: { mailboxId },
				query: { order: "desc", continuationToken: pageParam },
				throwOnError: true,
			});
			return data;
		},
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.continuationToken,
		// Previous rows while the next page is in flight, but only under the
		// filter that fetched them — a chip change restarts the list on the
		// skeleton rather than showing the old predicate's mail under the new
		// chip for one round trip.
		placeholderData: (previousData, previousQuery) =>
			sameInboxFilter(previousQuery?.queryKey, activeFilterParams)
				? previousData
				: undefined,
	});

	const { accountId: mailboxAccountId, isLoading: mailboxAccountLoading } =
		useMailboxAccount(mailboxId);
	const mailboxName = useCurrentMailboxName({ accounts });

	// The server answered the active predicate, so these rows are the list: the
	// dedupe spans pages and the deleted drop repeats the server's own
	// `excludeDeleted`, and neither result changes when another page loads.
	// Residual tokens are the exception — the request could not carry them, so
	// they are applied here over what came back. That thins a page rather than
	// answering over the whole mailbox, which is why the empty state stops
	// claiming the folder was read and the escalation predicate is withheld.
	const threads = applyResidualTokens(
		dropDeletedThreads(
			dedupeThreadMessages(
				threadsData?.pages.flatMap((page) => page.items ?? []) ?? [],
			),
		),
		residualTokens,
		mailboxAccountId,
	);

	const onSelectFilterCategory = useCallback((id: string) => {
		setFilterCategory(id);
	}, []);
	const onToggleFilterAttribute = useCallback((id: string) => {
		setFilterAttributes((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);
	const onClearFilters = useCallback(() => {
		setFilterCategory("all");
		setFilterAttributes(new Set());
	}, []);

	// The empty state has to say how much was read, and the reach comes off the
	// request rather than the call site: the day a chip is answered over a window
	// instead of the whole mailbox, the sentence changes with it.
	const filterLabel = CATEGORY_LABELS.get(filterCategory);
	const listFilter: MessageListFilter | undefined = filterLabel
		? {
				label: filterLabel,
				reach:
					residualTokens.length > 0
						? "loaded-pages"
						: filterReach(searchThreadsQuery),
				onClear: onClearFilters,
			}
		: undefined;

	// The row this folder itself lists, preferred because a mutation patches it in
	// place. A thread the loaded pages do not hold — a chip that paged it out, a
	// cross-folder hit, a cold address — is in no listing here and answers for
	// itself, which is what the snapshot and the URL's spare thread id used to
	// stand in for.
	const listedThread = threadId
		? (threads.find((t) => t.messageId === pointedAtMessageId) ??
			threads.find((t) => t.threadId === threadId))
		: undefined;
	const ownRow = useThreadRow(threadId, pointedAtMessageId);
	const selectedThread = listedThread ?? ownRow;

	const selectedMessageId = pointedAtMessageId ?? selectedThread?.messageId;

	const conversation = useMemo<ConversationTarget | undefined>(() => {
		if (!threadId) return undefined;
		return {
			threadId,
			mailboxId: selectedThread?.mailboxId ?? mailboxId,
			subject: selectedThread?.subject,
			messageId: selectedMessageId,
			authenticity: selectedThread?.authenticity,
		};
	}, [threadId, selectedThread, selectedMessageId, mailboxId]);

	// Esc unwinds one step at a time: an active selection first (handled by the
	// triage layer), then the open thread — which is a navigation up to the list,
	// so nothing is left mounted below it.

	const handleDeselectIfRemoved = useCallback(
		(removedIds: string[]) => {
			if (!selectedMessageId) return;
			if (!removedIds.includes(selectedMessageId)) return;
			closeThread();
		},
		[selectedMessageId, closeThread],
	);

	const { deleteMessages: handleDeleteMessages, isPending: isDeleting } =
		useDeleteMessages({
			mailboxId,
			onAfterOptimisticRemove: handleDeselectIfRemoved,
		});

	const { moveMessages: handleMoveMessages, isPending: isMoving } =
		useMoveMessages({
			mailboxId,
			accountId: mailboxAccountId,
			onAfterOptimisticRemove: handleDeselectIfRemoved,
		});

	const intelligenceRef = useRef<IntelligenceCommands | null>(null);

	const triage = useTriageContext();
	const {
		listCommandsRef,
		onTriageContextChange: handleTriageContextChange,
		focusedMessageId: triageFocusedId,
		selectedIds: triageSelectedIds,
	} = triage;

	const focusedThread =
		threads.find((t) => t.messageId === triageFocusedId) ?? selectedThread;

	// The mailbox's own unseen total. A count over the loaded pages undercounts
	// every mailbox larger than one page and creeps upward as the user scrolls,
	// so there is no fallback: until the mailbox resolves there is no number.
	const unreadCount = useCurrentMailboxUnseenCount({ accounts }) ?? 0;

	const toolbarActions = useThreadActions({
		thread: selectedThread,
		mailboxId,
		accountId: mailboxAccountId,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});

	const { draftsMailboxId } = useDraftsMailbox(mailboxAccountId);
	const isDraftsMailbox =
		draftsMailboxId !== undefined && draftsMailboxId === mailboxId;

	const { archiveMailboxId } = useArchiveMailbox(mailboxAccountId);

	const getThreadMessageIds = useThreadMessageIds();

	const openReply = useOpenReply();

	// The toolbar answers the conversation on screen; the keyboard answers the
	// row the cursor is on, which may be one the address has not opened yet. Both
	// are one navigation, because the mode and the message it answers are
	// segments of the same address.
	const replyToOpenThread = useMemo(
		() => replyToThread(openReply, threadId, selectedMessageId),
		[openReply, threadId, selectedMessageId],
	);

	const replyToFocusedThread = useMemo(() => {
		if (!focusedThread) return undefined;
		return (mode: ReplyMode) =>
			openReply({
				threadId: focusedThread.threadId,
				messageId: focusedThread.messageId,
				mode,
			});
	}, [openReply, focusedThread]);

	const isComposing = useIsComposing();
	const isReplying = useIsReplying();
	const openCompose = useOpenCompose();

	const messageIdsForFocusedThread = useCallback(
		(thread: typeof focusedThread): string[] => {
			if (!thread) return [];
			return getThreadMessageIds(thread);
		},
		[getThreadMessageIds],
	);

	const { toggleStar: focusedToggleStar } = useToggleStar({
		threadId: focusedThread?.threadId ?? "",
		mailboxId,
	});

	const { toggleReadFor: triageToggleReadFor } = useToggleReadFor({
		mailboxId,
		accountId: mailboxAccountId,
	});

	const { junkMailboxId } = useJunkMailbox(mailboxAccountId);
	const isSpamFolder = junkMailboxId != null && junkMailboxId === mailboxId;
	const junkDestinationId = junkDestination(junkMailboxId, mailboxId);
	const { candidates: rescueCandidates } = useRescueCandidates(
		isSpamFolder ? junkMailboxId : undefined,
	);
	const { moveMessages: triageMove } = useMoveMessages({
		mailboxId,
		threadId: focusedThread?.threadId,
		accountId: mailboxAccountId,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});
	const { deleteMessages: triageDelete } = useDeleteMessages({
		mailboxId,
		threadId: focusedThread?.threadId,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});

	const { addressId: focusedAddressId, address: focusedAddress } =
		useIntelligenceData(focusedThread);
	const { updateFlags: updateFocusedSenderFlags } = useUpdateAddressFlags({
		addressId: focusedAddressId,
		senderEmail: focusedThread?.fromEmail ?? undefined,
	});

	const triageReply = useCallback(
		() => replyToFocusedThread?.("reply"),
		[replyToFocusedThread],
	);
	const triageReplyAll = useCallback(
		() => replyToFocusedThread?.("reply-all"),
		[replyToFocusedThread],
	);
	const triageForward = useCallback(
		() => replyToFocusedThread?.("forward"),
		[replyToFocusedThread],
	);

	const triageTargetMessageIds = useCallback(
		(): string[] => messageIdsForFocusedThread(focusedThread),
		[messageIdsForFocusedThread, focusedThread],
	);

	// Every verb the list can take, it takes: over a selection it opens the
	// wizard, which is where a bulk action is reviewed before it reaches the mail
	// server (#477 1.4, #508). What falls through is aimed at the bare cursor, or
	// at the reading pane when no list is mounted — one message, not a bulk
	// action, and the pane acts on it directly.
	const triageDeleteAction = useCallback(() => {
		if (listCommandsRef.current?.requestVerb("delete")) return;
		const ids = triageTargetMessageIds();
		if (ids.length > 0) triageDelete(ids);
	}, [listCommandsRef, triageTargetMessageIds, triageDelete]);

	const triageMarkJunk = useCallback(() => {
		if (listCommandsRef.current?.requestVerb("junk")) return;
		if (!junkDestinationId) return;
		const ids = triageTargetMessageIds();
		if (ids.length === 0) return;
		recordRescueSentToJunk(telemetry, {
			count: ids.length,
			senderTrust: focusedThread?.senderTrust ?? "unknown",
			wasRescuable: focusedThread ? isRescueCandidate(focusedThread) : false,
		});
		triageMove(ids, junkDestinationId);
	}, [
		listCommandsRef,
		junkDestinationId,
		triageTargetMessageIds,
		triageMove,
		telemetry,
		focusedThread,
	]);

	// Star is the one verb that acts on a selection from here. It is not on the
	// selection bar and not one of the five the wizard walks: it sets a flag on
	// mail that is already in front of the user and unsets it the same way, so
	// there is nothing for a review screen to name and nothing to undo.
	const triageStar = useCallback(() => {
		if (triageSelectedIds.length > 0) {
			const nextStarred = !(focusedThread?.hasStars ?? false);
			const selected = new Set(triageSelectedIds);
			for (const thread of threads) {
				if (selected.has(thread.messageId) && thread.hasStars !== nextStarred) {
					focusedToggleStar(thread.messageId, thread.hasStars);
				}
			}
			return;
		}
		if (!focusedThread) return;
		focusedToggleStar(focusedThread.messageId, focusedThread.hasStars);
	}, [triageSelectedIds, threads, focusedThread, focusedToggleStar]);

	const triageToggleRead = useCallback(() => {
		if (listCommandsRef.current?.requestVerb("markRead")) return;
		const ids = triageTargetMessageIds();
		if (ids.length === 0) return;
		const nextRead = !(focusedThread?.isRead ?? false);
		triageToggleReadFor(ids, nextRead);
	}, [
		listCommandsRef,
		triageTargetMessageIds,
		focusedThread,
		triageToggleReadFor,
	]);

	const triageMute = useCallback(() => {
		if (!focusedAddressId) return;
		const next = !(focusedAddress?.flags?.muted?.value === true);
		updateFocusedSenderFlags({ muted: { value: next } });
	}, [focusedAddressId, focusedAddress, updateFocusedSenderFlags]);

	const triageVip = useCallback(() => {
		if (!focusedAddressId) return;
		const next = !(focusedAddress?.flags?.vip?.value === true);
		updateFocusedSenderFlags({ vip: { value: next } });
	}, [focusedAddressId, focusedAddress, updateFocusedSenderFlags]);

	// Block sender lives in intelligence, so the key raises whichever surface
	// this width has: the rail above 1280, the drawer below it. Reaching for
	// `onToggleIntelligence` from here wrote `#intelligence` at every tier, and
	// a panel the address names with no renderer behind it is a panel that opens
	// nothing (`docs/architecture/url-state.md`, R6).
	const triageBlock = useCallback(() => {
		intelligenceRef.current?.open();
	}, []);

	const mailboxType = isDraftsMailbox
		? "drafts"
		: archiveMailboxId === mailboxId
			? "archive"
			: junkMailboxId === mailboxId
				? "junk"
				: "inbox";

	const prevNormalizedSearchRef = useRef("");
	useEffect(() => {
		const prev = prevNormalizedSearchRef.current;
		prevNormalizedSearchRef.current = normalizedSearchQuery;
		if (normalizedSearchQuery.length > 0 && prev.length === 0) {
			telemetry.recordEvent("search.submitted", { mailboxType });
		}
	}, [normalizedSearchQuery, mailboxType, telemetry]);

	const { goBack, nextMessageId, previousMessageId } = useTriageLayer({
		context: triage,
		orderedIds: threads.map((t) => t.messageId),
		selectedMessageId,
		// The list stays mounted under both writing surfaces, so the triage keys
		// would otherwise fire at the message behind whatever is being typed — or
		// answer a row the cursor moved to while a reply was open.
		enabled: !isComposing && !isReplying,
		onClose: closeThread,
		handlers: {
			reply: triageReply,
			replyAll: triageReplyAll,
			forward: triageForward,
			delete: triageDeleteAction,
			toggleStar: triageStar,
			toggleRead: triageToggleRead,
			muteSender: triageMute,
			blockSender: selectedThread ? triageBlock : undefined,
			vipSender: triageVip,
			markJunk: triageMarkJunk,
			toggleIntelligence: selectedThread
				? () => intelligenceRef.current?.toggle()
				: undefined,
			compose: openCompose,
			goBrief: () => goToSection("brief"),
			goInbox: () => goToSection("brief"),
			goSent: () => goToSection("brief"),
			goFlagged: () => goToSection("flagged"),
			goSettings: () => goToSection("settings"),
		},
	});

	// The swipe gestures open a whole conversation, so the adjacent row has to
	// name its thread. This folder's own listing is where that is looked up, so a
	// row it does not hold offers no gesture rather than a tap that goes nowhere.
	const adjacentThread = (
		messageId: string | undefined,
	): OpenThreadTarget | undefined => {
		if (!messageId) return undefined;
		const row = threads.find((t) => t.messageId === messageId);
		return row ? { threadId: row.threadId, messageId } : undefined;
	};

	const ctx: MailboxPaneContextValue = {
		mailboxId,
		selectedMessageId,
		selectedThread,
		conversation,
		onOpenThread: openThread,
		threads,
		isLoading,
		isError,
		error,
		mailboxAccountId,
		mailboxAccountLoading,
		mailboxName,
		unreadCount,
		isDraftsMailbox,
		isSpamFolder,
		rescueCandidates,
		filterCategory,
		filterAttributes,
		onSelectFilterCategory,
		onToggleFilterAttribute,
		onClearFilters,
		listFilter,
		onToggleIntelligence,
		intelligenceRef,
		handleDeselectIfRemoved,
		// Escalation ("select all N matching") re-issues this predicate server-side
		// and acts on every match, so it is only offered when the predicate IS the
		// search: a residual token narrows the rows on screen but not the request,
		// and a bulk delete over the broader set would reach mail the search
		// excluded.
		searchPredicate:
			hasSearchQuery && residualTokens.length === 0
				? searchThreadsQuery
				: undefined,
		onDeleteMessages: handleDeleteMessages,
		onMoveMessages: handleMoveMessages,
		isDeleting,
		isMoving,
		onLoadMore: fetchNextPage,
		hasMore: hasNextPage,
		isLoadingMore: isFetchingNextPage,
		onTriageContextChange: handleTriageContextChange,
		listCommandsRef,
		onRetry: () => refetch(),
		onReply: replyToOpenThread,
		onToolbarDelete: toolbarActions.deleteThread,
		onToolbarStar: toolbarActions.toggleStar,
		isStarred: toolbarActions.isStarred,
		onToolbarMove: toolbarActions.moveThread,
		onBack: goBack,
		nextThread: adjacentThread(nextMessageId),
		previousThread: adjacentThread(previousMessageId),
	};

	return (
		<MailboxPaneCtx.Provider value={ctx}>{children}</MailboxPaneCtx.Provider>
	);
}

/* ------------------------------------------------------------------ */
/* Sub-views                                                            */
/* ------------------------------------------------------------------ */

/**
 * List pane: MessageList or DraftsView.
 * Mount in the `list` slot of `AppShellSlotted`.
 */
function MailboxList() {
	const {
		mailboxId,
		selectedMessageId,
		threads,
		isLoading,
		isError,
		error,
		onDeleteMessages,
		onMoveMessages,
		isDeleting,
		isMoving,
		onLoadMore,
		hasMore,
		isLoadingMore,
		mailboxAccountId,
		mailboxName,
		unreadCount,
		isDraftsMailbox,
		isSpamFolder,
		rescueCandidates,
		onTriageContextChange,
		listCommandsRef,
		onRetry,
		filterCategory,
		filterAttributes,
		onSelectFilterCategory,
		onToggleFilterAttribute,
		onClearFilters,
		listFilter,
		searchPredicate,
	} = useMailboxPane();
	const { searchQuery, searchInput, accounts, resultFolderIndex } =
		useMailContext();
	const tier = useLayoutTier();
	const openThread = useOpenThread();

	const listTitle = mailboxName ?? "Inbox";
	const preset = useMemo(() => inboxFilterConfig(), []);

	// Empty Trash, on the same test the Spam rescue strip uses: the open mailbox
	// is the one this account appoints to the role. Whether it may be emptied is
	// never decided here — the press goes to the server and the 409 answers it.
	const { trashMailboxId } = useTrashMailbox(mailboxAccountId);
	const trashMessageCount = useCurrentMailboxMessageCount({ accounts });
	const { trashByAccount } = useTrashByAccount();
	const emptyTrash = useEmptyTrash({
		accountId: mailboxAccountId,
		mailboxId,
	});
	const isTrashFolder = trashMailboxId != null && trashMailboxId === mailboxId;

	// The account owning this folder — undefined for the instant before
	// `useMailboxAccount` resolves it, which simply means there is nothing to
	// refresh yet.
	const refreshAccountIds = useMemo(
		() => (mailboxAccountId ? [mailboxAccountId] : []),
		[mailboxAccountId],
	);
	const { hasNewMail } = useMailFreshness();
	const {
		state: refreshState,
		errorMessage: refreshError,
		refresh: onRefreshMailbox,
	} = useRefreshControl(refreshAccountIds, { onSettled: onRetry });
	// Memoized: this element is a dep of `MailListHeader`'s own `chrome` memo
	// (via the `refreshControl` prop), so a fresh element identity every render
	// would defeat that memo and re-render every chrome consumer with it.
	const refreshControl = useMemo(
		() => (
			<RefreshButton
				state={refreshState}
				onRefresh={onRefreshMailbox}
				label={`Refresh ${listTitle}`}
				errorMessage={refreshError}
				hasUpdate={hasNewMail(refreshAccountIds)}
			/>
		),
		[
			refreshState,
			onRefreshMailbox,
			listTitle,
			refreshError,
			hasNewMail,
			refreshAccountIds,
		],
	);

	const searchResults = useMemo(
		() =>
			threads.map((thread) => threadToSearchResult(thread, resultFolderIndex)),
		[threads, resultFolderIndex],
	);
	// The route scopes this view and the top bar's chip says so, so every engine
	// here respects it: the literal engine searches this mailbox, and the
	// semantic engine takes the same `mailboxId`. No chip means global; a chip
	// means nothing on the route reaches past it. Results are deduped by thread,
	// so a thread never shows in both sections.
	const { hits: semanticHits, isLoading: relatedLoading } = useSemanticSearch({
		mailboxId,
		filterCategory,
	});
	const relatedResults = useMemo(
		() =>
			relatedSearchResults(
				semanticHits,
				threads.map((t) => t.threadId),
				resultFolderIndex,
			),
		[semanticHits, threads, resultFolderIndex],
	);
	// The two-engine results panel, whose semantic hits are in no list at all —
	// each one carries the thread it belongs to.
	const handleSelectSearchResult = useCallback(
		(result: SearchResult) => {
			const threadId =
				result.threadId ??
				threads.find((thread) => thread.messageId === result.id)?.threadId;
			if (!threadId) return;
			// Both sections are scoped to this mailbox, so a result's own mailbox is
			// normally this one; keep reading it off the result so a row can never
			// open under a mailbox it does not belong to.
			openThread(
				{ threadId, messageId: result.id },
				{ mailboxId: result.mailboxId ?? mailboxId, query: searchInput },
			);
		},
		[mailboxId, openThread, searchInput, threads],
	);

	// Drafts keep their own dedicated view (and header); they don't carry the
	// inbox category/attribute filter.
	if (isDraftsMailbox && mailboxAccountId) {
		return (
			<DraftsView
				accountId={mailboxAccountId}
				selectedMessageId={selectedMessageId}
				imapThreads={threads}
				title={mailboxName ?? "Drafts"}
				unreadCount={unreadCount ?? undefined}
			/>
		);
	}

	const messageList = (
		<MessageList
			mailboxId={mailboxId}
			threads={threads}
			selectedMessageId={selectedMessageId}
			isLoading={isLoading}
			isError={isError}
			error={error}
			onRetry={onRetry}
			searchQuery={searchQuery}
			searchPredicate={searchPredicate}
			onDeleteMessages={onDeleteMessages}
			isDeleting={isDeleting}
			isMoving={isMoving}
			onLoadMore={onLoadMore}
			hasMore={hasMore}
			isLoadingMore={isLoadingMore}
			accountId={mailboxAccountId}
			listTitle={listTitle}
			listFilter={listFilter}
			listScopeLabel={listTitle}
			hideHeader
			onTriageContextChange={onTriageContextChange}
			commandsRef={listCommandsRef}
		/>
	);

	const phoneAccountId = accounts[0]?.accountId;
	const listBody =
		tier === "phone" && phoneAccountId ? (
			<PullToRefresh accountId={phoneAccountId}>{messageList}</PullToRefresh>
		) : (
			messageList
		);

	const spamBody =
		isSpamFolder && rescueCandidates.length > 0 && mailboxAccountId ? (
			<SpamRescue
				accountId={mailboxAccountId}
				currentMailboxId={mailboxId}
				candidates={rescueCandidates}
				onMove={onMoveMessages}
			>
				{listBody}
			</SpamRescue>
		) : (
			listBody
		);

	const body = isTrashFolder ? (
		<EmptyTrashBar
			messageCount={trashMessageCount}
			isEmptying={emptyTrash.isEmptying}
			deletedCount={emptyTrash.deletedCount}
			refusalReason={emptyTrash.refusal?.reason}
			trashFolderLabel={mailboxName ?? undefined}
			staleFolderLabel={
				mailboxAccountId
					? trashByAccount.get(mailboxAccountId)?.staleFolderPath
					: undefined
			}
			onEmpty={emptyTrash.emptyTrash}
			onRepair={emptyTrash.repair}
		>
			{spamBody}
		</EmptyTrashBar>
	) : (
		spamBody
	);

	return (
		<MailViewChrome
			title={listTitle}
			unreadCount={unreadCount}
			preset={preset}
			selectedCategory={filterCategory}
			activeFilters={filterAttributes}
			onSelectCategory={onSelectFilterCategory}
			onToggleFilter={onToggleFilterAttribute}
			onClearFilters={onClearFilters}
			searchResults={searchResults}
			searchLoading={isLoading}
			relatedResults={relatedResults}
			relatedLoading={relatedLoading}
			onSelectSearchResult={handleSelectSearchResult}
			// A committed mailbox search renders in the body's own `MessageList`
			// (its threads filter to the results), so the multi-select toolbar and
			// the "Select all N matching" escalation are reachable on desktop (#212).
			// The typing/uncommitted state still shows the two-engine panel.
			searchResultsInBody
			refreshControl={refreshControl}
		>
			{body}
		</MailViewChrome>
	);
}

/**
 * Reading pane: MessageToolbar + ConversationView / ReadingPaneEmpty.
 * Mount in the `reading` slot of `AppShellSlotted`. Only rendered ≥ 1024px.
 */
function MailboxReading() {
	const {
		mailboxId,
		mailboxAccountId,
		mailboxAccountLoading,
		selectedThread,
		conversation,
		onReply,
		onToolbarDelete,
		onToolbarStar,
		isStarred,
		onToolbarMove,
		handleDeselectIfRemoved,
		intelligenceRef,
	} = useMailboxPane();
	const hasThread = Boolean(conversation);
	const intelligence = useIntelligenceSurface(conversation?.threadId);
	usePublishIntelligenceCommands(intelligenceRef, intelligence);

	// The rail opens itself on a DKIM mismatch. It lives here, behind the rail's
	// own width gate, because raising it writes `#intelligence` into the address
	// — and a panel the address names with no renderer behind it is a panel that
	// opens nothing (`docs/architecture/url-state.md`, R6). Below this width the
	// banner is the announcement and its "Why?" is the way in.
	const autoOpenedForRef = useRef<string | null>(null);
	const { railFits, openRail } = intelligence;
	useEffect(() => {
		if (!railFits) return;
		const id = selectedThread?.messageId ?? null;
		if (!id) return;
		if (autoOpenedForRef.current === id) return;
		if (!selectedThread?.authenticity?.dkimMismatch) return;
		autoOpenedForRef.current = id;
		openRail();
	}, [
		railFits,
		openRail,
		selectedThread?.messageId,
		selectedThread?.authenticity?.dkimMismatch,
	]);

	const detailPane = conversation ? (
		<ConversationView
			threadId={conversation.threadId}
			mailboxId={conversation.mailboxId}
			subject={conversation.subject}
			selectedMessageId={conversation.messageId}
			authenticity={conversation.authenticity}
			onOpenIntelligence={intelligence.open}
		/>
	) : (
		<ReadingPaneEmpty />
	);

	return (
		<>
			<section className="flex h-full w-full min-w-0 flex-col bg-canvas">
				<MessageToolbar
					hasThread={hasThread}
					messageId={conversation?.messageId}
					intelligenceOpen={intelligence.isShowing}
					canToggleIntelligence={intelligence.canToggle}
					onToggleIntelligence={intelligence.toggle}
					onReply={onReply ? () => onReply("reply") : undefined}
					onReplyAll={onReply ? () => onReply("reply-all") : undefined}
					onForward={onReply ? () => onReply("forward") : undefined}
					onDelete={hasThread ? onToolbarDelete : undefined}
					onToggleStar={hasThread ? onToolbarStar : undefined}
					isStarred={isStarred}
					moveContext={
						hasThread && mailboxAccountId
							? {
									accountId: mailboxAccountId,
									currentMailboxId: mailboxId,
									onMove: onToolbarMove,
								}
							: undefined
					}
					moveContextLoading={mailboxAccountLoading}
				/>
				<div className="min-h-0 flex-1 overflow-hidden">{detailPane}</div>
			</section>
			<IntelligenceDrawer
				isOpen={intelligence.drawerOpen}
				onClose={intelligence.closeDrawer}
				thread={selectedThread}
				mailboxId={mailboxId}
				accountId={mailboxAccountId}
				onAfterOptimisticRemove={handleDeselectIfRemoved}
			/>
		</>
	);
}

/**
 * Intelligence pane: IntelligencePane for the open thread.
 * Mount in the `intelligence` slot of `AppShellSlotted`. Only rendered ≥ 1280px.
 */
function MailboxIntelligence() {
	const {
		mailboxId,
		mailboxAccountId,
		selectedThread,
		onToggleIntelligence,
		handleDeselectIfRemoved,
	} = useMailboxPane();

	return (
		<IntelligencePane
			onClose={onToggleIntelligence}
			thread={selectedThread}
			mailboxId={mailboxId}
			accountId={mailboxAccountId}
			onAfterOptimisticRemove={handleDeselectIfRemoved}
		/>
	);
}

/**
 * Phone view: ConversationView (when a thread is open) or MessageList.
 * Use this on phones instead of the slot sub-views.
 */
function MailboxPhone() {
	const {
		mailboxId,
		mailboxAccountId,
		selectedThread,
		conversation,
		onOpenThread,
		onBack,
		nextThread,
		previousThread,
		handleDeselectIfRemoved,
		intelligenceRef,
	} = useMailboxPane();
	// The drawer directly, not `useIntelligenceSurface`: this view is what the
	// shell mounts where it has one pane, so there is no rail to choose between
	// — and the rail's own width gate answers yes on a wide portrait tablet the
	// shell still put here.
	const drawer = useIntelligenceDrawer(conversation?.threadId ?? null);
	usePublishIntelligenceCommands(intelligenceRef, drawer);

	if (conversation) {
		return (
			<>
				<ConversationView
					threadId={conversation.threadId}
					mailboxId={conversation.mailboxId}
					subject={conversation.subject}
					selectedMessageId={conversation.messageId}
					authenticity={conversation.authenticity}
					onBack={onBack}
					onOpenIntelligence={drawer.toggle}
					onSwipeNext={nextThread ? () => onOpenThread(nextThread) : undefined}
					onSwipePrevious={
						previousThread ? () => onOpenThread(previousThread) : undefined
					}
					mobileIntelligenceOpen={drawer.isOpen}
				/>
				<IntelligenceDrawer
					isOpen={drawer.isOpen}
					onClose={drawer.close}
					thread={selectedThread}
					mailboxId={mailboxId}
					accountId={mailboxAccountId}
					onAfterOptimisticRemove={handleDeselectIfRemoved}
				/>
			</>
		);
	}

	return <MailboxList />;
}

/* ------------------------------------------------------------------ */
/* Compound component assembly                                          */
/* ------------------------------------------------------------------ */

const MailboxPane = Object.assign(MailboxPaneProvider, {
	List: MailboxList,
	Reading: MailboxReading,
	Intelligence: MailboxIntelligence,
	Phone: MailboxPhone,
});

export { MailboxPane };
