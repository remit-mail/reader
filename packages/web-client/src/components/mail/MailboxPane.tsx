/**
 * MailboxPane — compound component for the mailbox view.
 *
 * Encapsulates all state, hooks, and rendering for the /mail/$mailboxId view.
 * The parent (`mail.tsx`) mounts `<MailboxPane>` around the `AppShellSlotted`
 * and passes the sub-views into slots:
 *
 *   <MailboxPane mailboxId={...} selectedMessageId={...}>
 *     <AppShellSlotted
 *       list={<MailboxPane.List />}
 *       reading={<MailboxPane.Reading />}
 *       intelligence={<MailboxPane.Intelligence />}
 *     />
 *   </MailboxPane>
 *
 * On phone, use `<MailboxPane.Phone />` instead of the slot sub-views.
 */
import {
	outboxDetailOperationsDeleteOutboxMessageMutation,
	outboxOperationsListOutboxMessagesQueryKey,
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
	type RescueCandidate,
	type SearchResult,
	useAppShellLayout,
} from "@remit/ui";
import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
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
import type { ComposeMode } from "@/components/compose/ComposeProvider";
import { useCompose } from "@/components/compose/ComposeProvider";
import { FullCompose } from "@/components/compose/FullCompose";
import { Drawer } from "@/components/layout/Drawer";
import { ConversationView } from "@/components/mail/ConversationView";
import { DraftsView } from "@/components/mail/DraftsView";
import { IntelligencePane } from "@/components/mail/IntelligencePane";
import {
	MessageList,
	type MessageListCommands,
} from "@/components/mail/MessageList";
import { MessageToolbar } from "@/components/mail/MessageToolbar";
import { PullToRefresh } from "@/components/mail/PullToRefresh";
import { SpamRescue } from "@/components/mail/SpamRescue";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { buildMutationErrorBanner } from "@/components/ui/error-banners";
import {
	useArchiveMailbox,
	useDraftsMailbox,
	useJunkMailbox,
} from "@/hooks/useArchiveMailbox";
import {
	useCurrentMailboxName,
	useCurrentMailboxUnseenCount,
} from "@/hooks/useCurrentMailboxName";
import {
	dropDeletedThreads,
	useDeleteMessages,
} from "@/hooks/useDeleteMessages";
import type { EscalationSearchQuery } from "@/hooks/useEscalatedActions";
import { useIntelligenceData } from "@/hooks/useIntelligenceData";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useLayoutTier } from "@/hooks/useLayoutTier";
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import { useToggleReadFor } from "@/hooks/useMarkAsRead";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useRescueCandidates } from "@/hooks/useRescueCandidates";
import { useSearchTokenContext } from "@/hooks/useSearchTokenContext";
import { useSemanticSearch } from "@/hooks/useSemanticSearch";
import { useThreadActions } from "@/hooks/useThreadActions";
import { useThreadMessageIds } from "@/hooks/useThreadMessageIds";
import { useToggleStar } from "@/hooks/useToggleStar";
import { useTriageContext, useTriageLayer } from "@/hooks/useTriageLayer";
import { useUpdateAddressFlags } from "@/hooks/useUpdateAddressFlags";
import {
	buildConversationTarget,
	type ConversationTarget,
} from "@/lib/conversation-target";
import { dedupeThreadMessages } from "@/lib/dedupe-thread-messages";
import {
	filterReach,
	hasInboxFilter,
	type InboxFilterCriteria,
	type InboxFilterParams,
	inboxFilterParams,
	sameInboxFilter,
} from "@/lib/inbox-filters";
import { readIntelligencePref } from "@/lib/intelligence-pref";
import { useMailContext } from "@/lib/mail-context";
import { isRescueCandidate } from "@/lib/rescue-candidates";
import { recordRescueSentToJunk } from "@/lib/rescue-telemetry";
import {
	isSearchPending as computeIsSearchPending,
	resolveOpenThread,
	resolveSelectedThread,
} from "@/lib/search-pending";
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
import { MailViewChrome } from "./MailViewChrome";

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

interface MailboxPaneContextValue {
	mailboxId: string;
	selectedMessageId: string | undefined;
	selectedThread: RemitImapThreadMessageResponse | undefined;
	/** The conversation to open — the loaded thread, or a tapped "Related" hit. */
	conversation: ConversationTarget | undefined;
	threads: RemitImapThreadMessageResponse[];
	isLoading: boolean;
	isError: boolean;
	error: unknown;
	mailboxAccountId: string | undefined;
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
	intelligenceOpen: boolean;
	onToggleIntelligence: () => void;
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
	/** Whether the list currently holds a selection, so the list header can
	 *  stand down and let the list's own selection bar take its place. */
	listSelectionActive: boolean;
	/** Where the list publishes the commands the keyboard layer drives. */
	listCommandsRef: RefObject<MessageListCommands | null>;
	onRetry: () => void;
	// Toolbar / reading pane actions
	toolbarComposeRequest: ComposeMode | null;
	onToolbarReply: () => void;
	onToolbarReplyAll: () => void;
	onToolbarForward: () => void;
	onClearComposeRequest: () => void;
	onToolbarDelete: () => void;
	onToolbarStar: () => void;
	onToolbarDiscardDraft: () => void;
	onToolbarMove: (destMailboxId: string) => void;
	composeState: ReturnType<typeof useCompose>["state"];
	closeCompose: () => void;
	hasRemitDraftOpen: boolean;
	// Phone actions
	onBack: () => void;
	nextMessageId: string | undefined;
	previousMessageId: string | undefined;
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
	selectedMessageId: string | undefined;
	children: ReactNode;
}

function MailboxPaneProvider({
	mailboxId,
	selectedMessageId,
	children,
}: MailboxPaneProps) {
	const navigate = useNavigate();
	const tier = useLayoutTier();
	const isDesktop = tier === "desktop";
	const telemetry = useTelemetry();
	const {
		accounts,
		searchQuery,
		searchInput,
		intelligenceOpen,
		onToggleIntelligence,
		onSetIntelligenceOpen,
	} = useMailContext();
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

	const handleDeselectIfRemoved = useCallback(
		(removedIds: string[]) => {
			if (!selectedMessageId) return;
			if (!removedIds.includes(selectedMessageId)) return;
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: (prev: Record<string, unknown>) => ({
					...prev,
					selectedMessageId: undefined,
					selectedThreadId: undefined,
				}),
			});
		},
		[selectedMessageId, mailboxId, navigate],
	);

	const { deleteMessages: handleDeleteMessages, isPending: isDeleting } =
		useDeleteMessages({
			mailboxId,
			onAfterOptimisticRemove: handleDeselectIfRemoved,
		});

	const { accountId: mailboxAccountId } = useMailboxAccount(mailboxId);
	const mailboxName = useCurrentMailboxName({ accounts });

	const { moveMessages: handleMoveMessages, isPending: isMoving } =
		useMoveMessages({
			mailboxId,
			accountId: mailboxAccountId,
			onAfterOptimisticRemove: handleDeselectIfRemoved,
		});

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

	const isSearchPending = computeIsSearchPending(searchInput, searchQuery);
	const listedThread = resolveSelectedThread(
		threads,
		selectedMessageId,
		isSearchPending,
	);
	// There is no unfiltered set in the client any more, so a chip the open
	// message does not match would otherwise close the reading pane under the
	// user. Snapshot what they opened and let it answer for itself.
	const [openedThread, setOpenedThread] = useState<
		RemitImapThreadMessageResponse | undefined
	>(undefined);
	useEffect(() => {
		if (listedThread) setOpenedThread(listedThread);
	}, [listedThread]);
	const selectedThread = resolveOpenThread(
		listedThread,
		openedThread,
		selectedMessageId,
		isSearchPending,
	);

	// A semantic "Related" hit can point at a message outside the loaded list, so
	// it carries its threadId through the URL; fall back to it (the mailbox is the
	// route param) so the conversation still opens.
	const { selectedThreadId } = useSearch({ strict: false }) as {
		selectedThreadId?: string;
	};
	const conversation = useMemo(
		() =>
			buildConversationTarget(selectedThread, {
				messageId: selectedMessageId,
				threadId: isSearchPending ? undefined : selectedThreadId,
				mailboxId,
			}),
		[
			selectedThread,
			selectedMessageId,
			selectedThreadId,
			isSearchPending,
			mailboxId,
		],
	);

	const triage = useTriageContext();
	const {
		listCommandsRef,
		onTriageContextChange: handleTriageContextChange,
		focusedMessageId: triageFocusedId,
		selectedIds: triageSelectedIds,
	} = triage;

	const focusedThread =
		threads.find((t) => t.messageId === triageFocusedId) ?? selectedThread;

	// Auto-open intelligence pane on DKIM mismatch.
	const autoOpenedForRef = useRef<string | null>(null);
	useEffect(() => {
		const id = selectedThread?.messageId ?? null;
		if (!id) return;
		if (autoOpenedForRef.current === id) return;
		if (selectedThread?.authenticity?.dkimMismatch) {
			autoOpenedForRef.current = id;
			if (!intelligenceOpen) onToggleIntelligence();
		}
	}, [
		selectedThread?.messageId,
		selectedThread?.authenticity?.dkimMismatch,
		intelligenceOpen,
		onToggleIntelligence,
	]);

	// Desktop default-open (#782)
	const appliedDefaultRef = useRef(false);
	useEffect(() => {
		if (appliedDefaultRef.current) return;
		if (!isDesktop) return;
		if (!selectedThread?.messageId) return;
		appliedDefaultRef.current = true;
		if (readIntelligencePref() && !intelligenceOpen) {
			onSetIntelligenceOpen(true);
		}
	}, [
		isDesktop,
		selectedThread?.messageId,
		intelligenceOpen,
		onSetIntelligenceOpen,
	]);

	// The mailbox's own unseen total. A count over the loaded pages undercounts
	// every mailbox larger than one page and creeps upward as the user scrolls,
	// so there is no fallback: until the mailbox resolves there is no number.
	const unreadCount = useCurrentMailboxUnseenCount({ accounts }) ?? 0;

	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

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

	const { requestCompose: setToolbarComposeRequest } = toolbarActions;

	const handleToolbarReply = useCallback(() => {
		setToolbarComposeRequest("reply");
	}, [setToolbarComposeRequest]);
	const handleToolbarReplyAll = useCallback(() => {
		setToolbarComposeRequest("reply_all");
	}, [setToolbarComposeRequest]);
	const handleToolbarForward = useCallback(() => {
		setToolbarComposeRequest("forward");
	}, [setToolbarComposeRequest]);

	const { state: composeState, openCompose, closeCompose } = useCompose();

	const handleNewCompose = useCallback(() => {
		openCompose({ mode: "new" });
	}, [openCompose]);

	const deleteOutboxMutation = useMutation({
		...outboxDetailOperationsDeleteOutboxMessageMutation(),
		onError: (mutationError) => {
			pushError(
				buildMutationErrorBanner(
					"Couldn't discard draft",
					"The draft wasn't deleted.",
					mutationError,
				),
			);
		},
	});
	const handleToolbarDiscardDraft = useCallback(() => {
		const outboxMessageId = composeState.outboxMessageId;
		if (!outboxMessageId) return;
		deleteOutboxMutation.mutate({ path: { outboxMessageId } });
		queryClient.invalidateQueries({
			queryKey: outboxOperationsListOutboxMessagesQueryKey(),
		});
		closeCompose();
	}, [
		composeState.outboxMessageId,
		deleteOutboxMutation,
		queryClient,
		closeCompose,
	]);

	// Esc unwinds one step at a time: an active selection first (handled by the
	// triage layer), then the open thread.
	const closeThread = useCallback(() => {
		navigate({
			to: "/mail/$mailboxId",
			params: { mailboxId },
			search: (prev: Record<string, unknown>) => ({
				...prev,
				selectedMessageId: undefined,
				selectedThreadId: undefined,
			}),
		});
	}, [mailboxId, navigate]);

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

	const ensureFocusedOpen = useCallback(() => {
		if (selectedMessageId || !triageFocusedId) return false;
		navigate({
			to: "/mail/$mailboxId",
			params: { mailboxId },
			search: (prev: Record<string, unknown>) => ({
				...prev,
				selectedMessageId: triageFocusedId,
			}),
		});
		return true;
	}, [selectedMessageId, triageFocusedId, mailboxId, navigate]);

	const triageReply = useCallback(() => {
		if (ensureFocusedOpen()) return;
		if (selectedThread) setToolbarComposeRequest("reply");
	}, [ensureFocusedOpen, selectedThread, setToolbarComposeRequest]);
	const triageReplyAll = useCallback(() => {
		if (ensureFocusedOpen()) return;
		if (selectedThread) setToolbarComposeRequest("reply_all");
	}, [ensureFocusedOpen, selectedThread, setToolbarComposeRequest]);
	const triageForward = useCallback(() => {
		if (ensureFocusedOpen()) return;
		if (selectedThread) setToolbarComposeRequest("forward");
	}, [ensureFocusedOpen, selectedThread, setToolbarComposeRequest]);

	const triageTargetMessageIds = useCallback((): string[] => {
		if (triageSelectedIds.length > 0) return triageSelectedIds;
		return messageIdsForFocusedThread(focusedThread);
	}, [triageSelectedIds, messageIdsForFocusedThread, focusedThread]);

	// Prefer the list's delete: it confirms the move to Trash and then places the
	// cursor on a surviving row. Falls back to the reading pane's message when no
	// list is mounted or nothing in it is targeted.
	const triageDeleteAction = useCallback(() => {
		if (listCommandsRef.current?.requestDelete()) return;
		const ids = triageTargetMessageIds();
		if (ids.length > 0) triageDelete(ids);
	}, [listCommandsRef, triageTargetMessageIds, triageDelete]);

	const triageMarkJunk = useCallback(() => {
		if (!junkMailboxId) return;
		const ids = triageTargetMessageIds();
		if (ids.length === 0) return;
		recordRescueSentToJunk(telemetry, {
			count: ids.length,
			senderTrust: focusedThread?.senderTrust ?? "unknown",
			wasRescuable: focusedThread ? isRescueCandidate(focusedThread) : false,
		});
		triageMove(ids, junkMailboxId);
	}, [
		junkMailboxId,
		triageTargetMessageIds,
		triageMove,
		telemetry,
		focusedThread,
	]);

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
		const ids = triageTargetMessageIds();
		if (ids.length === 0) return;
		const nextRead = !(focusedThread?.isRead ?? false);
		triageToggleReadFor(ids, nextRead);
	}, [triageTargetMessageIds, focusedThread, triageToggleReadFor]);

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

	const triageBlock = useCallback(() => {
		if (!intelligenceOpen) onToggleIntelligence();
	}, [intelligenceOpen, onToggleIntelligence]);

	const goToRoute = useCallback(
		(to: "/mail" | "/mail/flagged" | "/settings") => {
			navigate({ to });
		},
		[navigate],
	);

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

	const hasRemitDraftOpen =
		isDraftsMailbox &&
		composeState.isOpen &&
		!!composeState.outboxMessageId &&
		!selectedThread;

	const { goBack, nextMessageId, previousMessageId } = useTriageLayer({
		context: triage,
		orderedIds: threads.map((t) => t.messageId),
		selectedMessageId,
		enabled: !composeState.isOpen,
		onClose: closeThread,
		handlers: {
			reply: triageReply,
			replyAll: triageReplyAll,
			forward: triageForward,
			delete: triageDeleteAction,
			toggleStar: triageStar,
			toggleRead: triageToggleRead,
			muteSender: triageMute,
			blockSender: triageBlock,
			vipSender: triageVip,
			markJunk: triageMarkJunk,
			toggleIntelligence: selectedThread ? onToggleIntelligence : undefined,
			compose: handleNewCompose,
			goBrief: () => goToRoute("/mail"),
			goInbox: () => goToRoute("/mail"),
			goSent: () => goToRoute("/mail"),
			goFlagged: () => goToRoute("/mail/flagged"),
			goSettings: () => goToRoute("/settings"),
		},
	});

	useKeyboardNavigation({
		enabled: composeState.isOpen,
		bindings: [{ key: "Escape", handler: closeCompose, preventDefault: true }],
	});

	const ctx: MailboxPaneContextValue = {
		mailboxId,
		selectedMessageId,
		selectedThread,
		conversation,
		threads,
		isLoading,
		isError,
		error,
		mailboxAccountId,
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
		intelligenceOpen,
		onToggleIntelligence,
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
		listSelectionActive: triageSelectedIds.length > 0,
		listCommandsRef,
		onRetry: () => refetch(),
		toolbarComposeRequest: toolbarActions.composeRequest,
		onToolbarReply: handleToolbarReply,
		onToolbarReplyAll: handleToolbarReplyAll,
		onToolbarForward: handleToolbarForward,
		onClearComposeRequest: toolbarActions.clearComposeRequest,
		onToolbarDelete: toolbarActions.deleteThread,
		onToolbarStar: toolbarActions.toggleStar,
		onToolbarDiscardDraft: handleToolbarDiscardDraft,
		onToolbarMove: toolbarActions.moveThread,
		composeState,
		closeCompose,
		hasRemitDraftOpen,
		onBack: goBack,
		nextMessageId,
		previousMessageId,
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
		listSelectionActive,
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
	const navigate = useNavigate();

	const listTitle = mailboxName ?? "Inbox";
	const preset = useMemo(() => inboxFilterConfig(), []);

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
	const handleSelectSearchResult = useCallback(
		(result: SearchResult) =>
			navigate({
				to: "/mail/$mailboxId",
				// Both sections are scoped to this mailbox, so a result's own
				// mailbox is normally this one; keep reading it off the result so a
				// row can never open under a mailbox it does not belong to.
				params: { mailboxId: result.mailboxId ?? mailboxId },
				search: (prev: Record<string, unknown>) => ({
					...prev,
					// Commit the active query alongside the selection. The debounced
					// q-mirror (mail.tsx) strips the selection whenever it sees the
					// query go active; the row can be tapped before the debounce settles
					// (it shows in the still-unfiltered list), so use the *live*
					// `searchInput` here — committing `q` makes the mirror a no-op and
					// keeps the opened result from being stripped out from under us.
					q: searchInput || undefined,
					selectedMessageId: result.id,
					selectedThreadId: result.threadId,
				}),
			}),
		[mailboxId, navigate, searchInput],
	);

	// Drafts keep their own dedicated view (and header); they don't carry the
	// inbox category/attribute filter.
	if (isDraftsMailbox && mailboxAccountId) {
		return (
			<DraftsView
				mailboxId={mailboxId}
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
			onMoveMessages={onMoveMessages}
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

	const body =
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
			bodyOwnsSelectionBar={listSelectionActive}
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
		selectedThread,
		conversation,
		hasRemitDraftOpen,
		intelligenceOpen,
		onToggleIntelligence,
		toolbarComposeRequest,
		onToolbarReply,
		onToolbarReplyAll,
		onToolbarForward,
		onClearComposeRequest,
		onToolbarDelete,
		onToolbarStar,
		onToolbarDiscardDraft,
		onToolbarMove,
		composeState,
	} = useMailboxPane();
	// The rail's own width gate, not the shell tier: between 1024 and 1280 the
	// reading pane is mounted but the rail is not, so "enabled" would promise an
	// open that cannot happen.
	const railFits = useAppShellLayout()?.showIntelligencePane ?? false;
	const hasThread = Boolean(conversation);
	const canToggleIntelligence = railFits && hasThread;

	const detailPane =
		composeState.isOpen && !conversation ? (
			<FullCompose />
		) : conversation ? (
			<ConversationView
				threadId={conversation.threadId}
				mailboxId={conversation.mailboxId}
				subject={conversation.subject}
				selectedMessageId={conversation.messageId}
				authenticity={conversation.authenticity}
				onOpenIntelligence={
					conversation.authenticity?.dkimMismatch
						? onToggleIntelligence
						: undefined
				}
				composeRequest={toolbarComposeRequest}
				onComposeClose={onClearComposeRequest}
			/>
		) : (
			<ReadingPaneEmpty />
		);

	return (
		<section className="flex h-full w-full min-w-0 flex-col bg-canvas">
			<MessageToolbar
				hasThread={hasThread}
				intelligenceOpen={canToggleIntelligence && intelligenceOpen}
				canToggleIntelligence={canToggleIntelligence}
				onToggleIntelligence={onToggleIntelligence}
				onReply={hasThread ? onToolbarReply : undefined}
				onReplyAll={hasThread ? onToolbarReplyAll : undefined}
				onForward={hasThread ? onToolbarForward : undefined}
				canDelete={hasThread || hasRemitDraftOpen}
				onDelete={
					hasThread
						? onToolbarDelete
						: hasRemitDraftOpen
							? onToolbarDiscardDraft
							: undefined
				}
				onToggleStar={hasThread ? onToolbarStar : undefined}
				isStarred={selectedThread?.hasStars}
				moveContext={
					hasThread && mailboxAccountId
						? {
								accountId: mailboxAccountId,
								currentMailboxId: mailboxId,
								onMove: onToolbarMove,
							}
						: undefined
				}
			/>
			<div className="min-h-0 flex-1 overflow-hidden">{detailPane}</div>
		</section>
	);
}

/**
 * Intelligence pane: IntelligencePane for the open thread.
 * Mount in the `intelligence` slot of `AppShellSlotted`. Only rendered ≥ 1280px.
 */
function MailboxIntelligence() {
	const { mailboxId, mailboxAccountId, selectedThread, onToggleIntelligence } =
		useMailboxPane();

	return (
		<IntelligencePane
			onClose={onToggleIntelligence}
			thread={selectedThread}
			mailboxId={mailboxId}
			accountId={mailboxAccountId}
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
		selectedThread,
		conversation,
		intelligenceOpen,
		onToggleIntelligence,
		onBack,
		nextMessageId,
		previousMessageId,
		composeState,
	} = useMailboxPane();
	const navigate = useNavigate();

	if (conversation) {
		const openMessage = (messageId: string) =>
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: (prev: Record<string, unknown>) => ({
					...prev,
					selectedMessageId: messageId,
					selectedThreadId: undefined,
				}),
			});

		return (
			<>
				<ConversationView
					threadId={conversation.threadId}
					mailboxId={conversation.mailboxId}
					subject={conversation.subject}
					selectedMessageId={conversation.messageId}
					authenticity={conversation.authenticity}
					onBack={onBack}
					onOpenIntelligence={onToggleIntelligence}
					onSwipeNext={
						nextMessageId ? () => openMessage(nextMessageId) : undefined
					}
					onSwipePrevious={
						previousMessageId ? () => openMessage(previousMessageId) : undefined
					}
					mobileIntelligenceOpen={intelligenceOpen}
				/>
				<Drawer
					isOpen={intelligenceOpen}
					onClose={onToggleIntelligence}
					ariaLabel="Message details"
					side="right"
				>
					<IntelligencePane
						onClose={onToggleIntelligence}
						thread={selectedThread}
						hideCloseButton
					/>
				</Drawer>
			</>
		);
	}

	if (composeState.isOpen) {
		return (
			<div className="h-full">
				<FullCompose />
			</div>
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
