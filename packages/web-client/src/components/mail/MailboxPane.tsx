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
	threadDetailOperationsListThreadMessagesQueryKey,
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
	ReadingPaneEmpty,
	type RescueCandidate,
} from "@remit/ui";
import {
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
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
import { MessageList } from "@/components/mail/MessageList";
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
import { useIntelligenceData } from "@/hooks/useIntelligenceData";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useLayoutTier } from "@/hooks/useLayoutTier";
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import { useToggleReadFor } from "@/hooks/useMarkAsRead";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useRescueCandidates } from "@/hooks/useRescueCandidates";
import { useSemanticSearch } from "@/hooks/useSemanticSearch";
import { useToggleStar } from "@/hooks/useToggleStar";
import { useTriageKeyboard } from "@/hooks/useTriageKeyboard";
import { useUpdateAddressFlags } from "@/hooks/useUpdateAddressFlags";
import { adjacentMessageId } from "@/lib/adjacent-message";
import { readIntelligencePref } from "@/lib/intelligence-pref";
import { useMailContext } from "@/lib/mail-context";
import { isRescueCandidate } from "@/lib/rescue-candidates";
import { recordRescueSentToJunk } from "@/lib/rescue-telemetry";
import {
	isSearchPending as computeIsSearchPending,
	resolveSelectedThread,
} from "@/lib/search-pending";
import { normalizeSearchQuery } from "@/lib/search-query";
import {
	relatedSearchResults,
	threadToSearchResult,
} from "@/lib/search-result";
import { useTelemetry } from "@/lib/telemetry-context";
import { MailViewChrome } from "./MailViewChrome";

/* ------------------------------------------------------------------ */
/* Inbox filter predicates — the inbox preset offers Unread / Flagged /
   Has attachment (never accounts; an inbox is one account already).    */
/* ------------------------------------------------------------------ */

const INBOX_FILTER_PREDICATES: Record<
	string,
	(t: RemitImapThreadMessageResponse) => boolean
> = {
	unread: (t) => !t.isRead,
	flagged: (t) => t.star != null && t.star !== "none" && t.hasStars === true,
	attachment: (t) => Boolean(t.hasAttachment),
};

function applyInboxFilters(
	threads: RemitImapThreadMessageResponse[],
	category: string,
	attributes: ReadonlySet<string>,
): RemitImapThreadMessageResponse[] {
	const predicates = Array.from(attributes)
		.map((id) => INBOX_FILTER_PREDICATES[id])
		.filter(
			(p): p is (t: RemitImapThreadMessageResponse) => boolean => p != null,
		);
	if (category === "all" && predicates.length === 0) return threads;
	return threads.filter(
		(t) =>
			(category === "all" || t.category === category) &&
			predicates.every((p) => p(t)),
	);
}

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

interface MailboxPaneContextValue {
	mailboxId: string;
	selectedMessageId: string | undefined;
	selectedThread: RemitImapThreadMessageResponse | undefined;
	threads: RemitImapThreadMessageResponse[];
	isLoading: boolean;
	isError: boolean;
	error: unknown;
	mailboxAccountId: string | undefined;
	mailboxName: string | null;
	unreadCount: number;
	isDraftsMailbox: boolean;
	// Rescue-from-Spam: true on the account's Junk/Spam folder, with the
	// suspected-safe messages over the loaded pages. Drives the rescue banner
	// + flow above the spam list.
	isSpamFolder: boolean;
	rescueCandidates: RescueCandidate[];
	// Inbox filter (category + Unread/Flagged/Attachment), applied client-side
	// over the loaded threads. Owned here so the list, triage and adjacency all
	// see the same filtered set; the open thread still resolves against the raw
	// set so a filter never closes the reading pane.
	filterCategory: string;
	filterAttributes: ReadonlySet<string>;
	onSelectFilterCategory: (id: string) => void;
	onToggleFilterAttribute: (id: string) => void;
	onClearFilters: () => void;
	showIntelligence: boolean;
	intelligenceOpen: boolean;
	onToggleIntelligence: () => void;
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
	}) => void;
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
	openCompose: () => void;
	closeCompose: () => void;
	hasRemitDraftOpen: boolean;
	// Phone actions
	onBack: () => void;
	nextMessageId: string | undefined;
	previousMessageId: string | undefined;
}

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

	const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
	const hasSearchQuery = normalizedSearchQuery.length > 0;

	const queryKey = hasSearchQuery
		? threadOperationsSearchThreadsQueryKey({
				path: { mailboxId },
				query: { order: "desc", query: normalizedSearchQuery },
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
			if (hasSearchQuery) {
				const { data } = await threadOperationsSearchThreads({
					path: { mailboxId },
					query: {
						order: "desc",
						query: normalizedSearchQuery,
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
		enabled: hasSearchQuery ? normalizedSearchQuery.length > 0 : true,
		placeholderData: keepPreviousData,
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

	const rawThreads = dropDeletedThreads(
		threadsData?.pages.flatMap((page) => page.items) ?? [],
	);

	const [filterCategory, setFilterCategory] = useState("all");
	const [filterAttributes, setFilterAttributes] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const threads = useMemo(
		() => applyInboxFilters(rawThreads, filterCategory, filterAttributes),
		[rawThreads, filterCategory, filterAttributes],
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

	const isSearchPending = computeIsSearchPending(searchInput, searchQuery);
	// Resolve the open thread against the raw set so an active filter never
	// empties the reading pane on a message the user explicitly opened.
	const selectedThread = resolveSelectedThread(
		rawThreads,
		selectedMessageId,
		isSearchPending,
	);

	const [triageFocusedId, setTriageFocusedId] = useState<string | undefined>(
		undefined,
	);
	const [triageSelectedIds, setTriageSelectedIds] = useState<string[]>([]);
	const handleTriageContextChange = useCallback(
		(context: {
			focusedMessageId: string | undefined;
			selectedIds: string[];
		}) => {
			setTriageFocusedId(context.focusedMessageId);
			setTriageSelectedIds(context.selectedIds);
		},
		[],
	);

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

	const mailboxUnseenCount = useCurrentMailboxUnseenCount({ accounts });
	const unreadCount =
		mailboxUnseenCount ?? rawThreads.filter((t) => !t.isRead).length;

	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	const { deleteMessages: toolbarDelete } = useDeleteMessages({
		mailboxId,
		threadId: selectedThread?.threadId,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});

	const { moveMessages: toolbarMove } = useMoveMessages({
		mailboxId,
		threadId: selectedThread?.threadId,
		accountId: mailboxAccountId,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});

	const { draftsMailboxId } = useDraftsMailbox(mailboxAccountId);
	const isDraftsMailbox =
		draftsMailboxId !== undefined && draftsMailboxId === mailboxId;

	const { archiveMailboxId } = useArchiveMailbox(mailboxAccountId);

	// Get thread message ids from cache; fall back to representative message id.
	const getThreadMessageIds = useCallback(
		(thread: RemitImapThreadMessageResponse) => {
			const threadKey = threadDetailOperationsListThreadMessagesQueryKey({
				path: { threadId: thread.threadId },
			});
			const cached = queryClient.getQueriesData<{
				items: { messageId: string }[];
			}>({ queryKey: threadKey });
			const ids = cached.flatMap(
				([, data]) => data?.items.map((m) => m.messageId) ?? [],
			);
			return ids.length > 0 ? ids : [thread.messageId];
		},
		[queryClient],
	);

	const handleToolbarDelete = useCallback(() => {
		if (!selectedThread) return;
		const messageIds = getThreadMessageIds(selectedThread);
		toolbarDelete(messageIds);
	}, [selectedThread, getThreadMessageIds, toolbarDelete]);

	const handleToolbarMove = useCallback(
		(destMailboxId: string) => {
			if (!selectedThread) return;
			const messageIds = getThreadMessageIds(selectedThread);
			toolbarMove(messageIds, destMailboxId);
		},
		[selectedThread, getThreadMessageIds, toolbarMove],
	);

	const { toggleStar: toolbarToggleStar } = useToggleStar({
		threadId: selectedThread?.threadId ?? "",
		mailboxId,
	});

	const handleToolbarStar = useCallback(() => {
		if (!selectedThread) return;
		toolbarToggleStar(selectedThread.messageId, selectedThread.hasStars);
	}, [selectedThread, toolbarToggleStar]);

	const [toolbarComposeRequest, setToolbarComposeRequest] =
		useState<ComposeMode | null>(null);

	const handleToolbarReply = useCallback(() => {
		setToolbarComposeRequest("reply");
	}, []);
	const handleToolbarReplyAll = useCallback(() => {
		setToolbarComposeRequest("reply_all");
	}, []);
	const handleToolbarForward = useCallback(() => {
		setToolbarComposeRequest("forward");
	}, []);
	const handleClearComposeRequest = useCallback(() => {
		setToolbarComposeRequest(null);
	}, []);

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

	const goBack = useCallback(() => {
		if (selectedMessageId) {
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: (prev: Record<string, unknown>) => ({
					...prev,
					selectedMessageId: undefined,
				}),
			});
		}
	}, [selectedMessageId, mailboxId, navigate]);

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
	const { candidates: rescueCandidates } = useRescueCandidates({
		mailboxId,
		isSpamFolder,
		loadedThreads: rawThreads,
	});
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
	}, [ensureFocusedOpen, selectedThread]);
	const triageReplyAll = useCallback(() => {
		if (ensureFocusedOpen()) return;
		if (selectedThread) setToolbarComposeRequest("reply_all");
	}, [ensureFocusedOpen, selectedThread]);
	const triageForward = useCallback(() => {
		if (ensureFocusedOpen()) return;
		if (selectedThread) setToolbarComposeRequest("forward");
	}, [ensureFocusedOpen, selectedThread]);

	const triageTargetMessageIds = useCallback((): string[] => {
		if (triageSelectedIds.length > 0) return triageSelectedIds;
		return messageIdsForFocusedThread(focusedThread);
	}, [triageSelectedIds, messageIdsForFocusedThread, focusedThread]);

	const triageDeleteAction = useCallback(() => {
		const ids = triageTargetMessageIds();
		if (ids.length > 0) triageDelete(ids);
	}, [triageTargetMessageIds, triageDelete]);

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

	const hasThread = Boolean(selectedThread);
	const hasRemitDraftOpen =
		isDraftsMailbox &&
		composeState.isOpen &&
		!!composeState.outboxMessageId &&
		!selectedThread;
	const showIntelligence = isDesktop && intelligenceOpen && hasThread;

	useTriageKeyboard({
		enabled: !composeState.isOpen,
		handlers: {
			back: goBack,
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

	const orderedMessageIds = threads.map((t) => t.messageId);
	const nextMessageId =
		adjacentMessageId(orderedMessageIds, selectedMessageId, "next") ??
		undefined;
	const previousMessageId =
		adjacentMessageId(orderedMessageIds, selectedMessageId, "previous") ??
		undefined;

	const ctx: MailboxPaneContextValue = {
		mailboxId,
		selectedMessageId,
		selectedThread,
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
		showIntelligence,
		intelligenceOpen,
		onToggleIntelligence,
		onDeleteMessages: handleDeleteMessages,
		onMoveMessages: handleMoveMessages,
		isDeleting,
		isMoving,
		onLoadMore: fetchNextPage,
		hasMore: hasNextPage,
		isLoadingMore: isFetchingNextPage,
		onTriageContextChange: handleTriageContextChange,
		onRetry: () => refetch(),
		toolbarComposeRequest,
		onToolbarReply: handleToolbarReply,
		onToolbarReplyAll: handleToolbarReplyAll,
		onToolbarForward: handleToolbarForward,
		onClearComposeRequest: handleClearComposeRequest,
		onToolbarDelete: handleToolbarDelete,
		onToolbarStar: handleToolbarStar,
		onToolbarDiscardDraft: handleToolbarDiscardDraft,
		onToolbarMove: handleToolbarMove,
		composeState,
		openCompose: handleNewCompose,
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
		onRetry,
		filterCategory,
		filterAttributes,
		onSelectFilterCategory,
		onToggleFilterAttribute,
		onClearFilters,
	} = useMailboxPane();
	const { searchQuery, accounts } = useMailContext();
	const tier = useLayoutTier();
	const navigate = useNavigate();

	const listTitle = mailboxName ?? "Inbox";
	const preset = useMemo(() => inboxFilterConfig(), []);

	const searchResults = useMemo(
		() => threads.map(threadToSearchResult),
		[threads],
	);
	// "Related" (semantic) is scoped to this mailbox and deduped against the
	// literal "Top matches" by thread, so a thread never shows in both.
	const { hits: semanticHits, isLoading: relatedLoading } = useSemanticSearch({
		mailboxId,
	});
	const relatedResults = useMemo(
		() =>
			relatedSearchResults(
				semanticHits,
				threads.map((t) => t.threadId),
			),
		[semanticHits, threads],
	);
	const handleSelectSearchResult = useCallback(
		(id: string) =>
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: (prev: Record<string, unknown>) => ({
					...prev,
					selectedMessageId: id,
				}),
			}),
		[mailboxId, navigate],
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
			onDeleteMessages={onDeleteMessages}
			onMoveMessages={onMoveMessages}
			isDeleting={isDeleting}
			isMoving={isMoving}
			onLoadMore={onLoadMore}
			hasMore={hasMore}
			isLoadingMore={isLoadingMore}
			accountId={mailboxAccountId}
			listTitle={listTitle}
			hideHeader
			onTriageContextChange={onTriageContextChange}
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
		hasRemitDraftOpen,
		showIntelligence,
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
		openCompose,
	} = useMailboxPane();
	const { searchInput, onSearchChange, onSearchClear, onSearchClearQuery } =
		useMailContext();
	const tier = useLayoutTier();
	const isDesktop = tier === "desktop";
	const hasThread = Boolean(selectedThread);

	const detailPane =
		composeState.isOpen && !selectedThread ? (
			<FullCompose />
		) : selectedThread ? (
			<ConversationView
				threadId={selectedThread.threadId}
				mailboxId={mailboxId}
				subject={selectedThread.subject}
				selectedMessageId={selectedThread.messageId}
				authenticity={selectedThread.authenticity}
				onOpenIntelligence={
					selectedThread.authenticity?.dkimMismatch
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
				onCompose={openCompose}
				intelligenceOpen={showIntelligence}
				showIntelligenceToggle={isDesktop && hasThread}
				onToggleIntelligence={onToggleIntelligence}
				searchValue={searchInput}
				onSearchChange={onSearchChange}
				onSearchClear={onSearchClear}
				onSearchClearQuery={onSearchClearQuery}
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
		intelligenceOpen,
		onToggleIntelligence,
		onBack,
		nextMessageId,
		previousMessageId,
		composeState,
	} = useMailboxPane();
	const navigate = useNavigate();

	if (selectedThread) {
		const openMessage = (messageId: string) =>
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: (prev: Record<string, unknown>) => ({
					...prev,
					selectedMessageId: messageId,
				}),
			});

		return (
			<>
				<ConversationView
					threadId={selectedThread.threadId}
					mailboxId={mailboxId}
					subject={selectedThread.subject}
					selectedMessageId={selectedThread.messageId}
					authenticity={selectedThread.authenticity}
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
