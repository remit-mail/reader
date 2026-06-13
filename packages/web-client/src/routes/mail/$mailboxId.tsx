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
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@remit/ui";
import {
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { ComposeMode } from "@/components/compose/ComposeProvider";
import { useCompose } from "@/components/compose/ComposeProvider";
import { FullCompose } from "@/components/compose/FullCompose";
import { ConversationView } from "@/components/mail/ConversationView";
import { DraftsView } from "@/components/mail/DraftsView";
import { IntelligencePane } from "@/components/mail/IntelligencePane";
import { MessageList } from "@/components/mail/MessageList";
import { MessageToolbar } from "@/components/mail/MessageToolbar";
import { PullToRefresh } from "@/components/mail/PullToRefresh";
import { EmptyState } from "@/components/ui/EmptyState";
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
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import { useToggleReadFor } from "@/hooks/useMarkAsRead";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useToggleStar } from "@/hooks/useToggleStar";
import { useTriageKeyboard } from "@/hooks/useTriageKeyboard";
import { useUpdateAddressFlags } from "@/hooks/useUpdateAddressFlags";
import { useMailContext } from "@/lib/mail-context";
import {
	isSearchPending as computeIsSearchPending,
	resolveSelectedThread,
} from "@/lib/search-pending";
import { normalizeSearchQuery } from "@/lib/search-query";

// Search schema includes q from parent route for proper inheritance
const mailboxSearchSchema = z.object({
	selectedMessageId: z.string().optional(),
	q: z.string().optional(),
});

type MailboxSearch = z.infer<typeof mailboxSearchSchema>;

export const Route = createFileRoute("/mail/$mailboxId")({
	component: MailboxView,
	validateSearch: mailboxSearchSchema,
});

function MailboxView() {
	const { mailboxId } = Route.useParams();
	const { selectedMessageId } = Route.useSearch();
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();
	const {
		accounts,
		searchQuery,
		searchInput,
		onSearchChange,
		onSearchClear,
		onSearchClearQuery,
		intelligenceOpen,
		onToggleIntelligence,
	} = useMailContext();

	// `searchQuery` is the debounced local value from context (URL `q` seeds it
	// once on mount; all updates stay local). Normalized before querying so
	// equivalent searches share a React Query cache entry.
	const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
	const hasSearchQuery = normalizedSearchQuery.length > 0;

	// Query key for cache management
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
				search: (prev: MailboxSearch) => ({
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

	// Flatten threads from all pages. Belt-and-braces filter against #212:
	// the backend already excludes soft-deleted rows, this protects the UI
	// against regressions and eventual-consistency windows.
	const threads = dropDeletedThreads(
		threadsData?.pages.flatMap((page) => page.items) ?? [],
	);

	// A debounce is pending while the live input differs from the committed
	// (debounced) query. Keep the reading pane closed during that window so it
	// clears the instant a new search starts (#539); once the query settles,
	// honor the selected result so search results can be opened (#623).
	const isSearchPending = computeIsSearchPending(searchInput, searchQuery);
	const selectedThread = resolveSelectedThread(
		threads,
		selectedMessageId,
		isSearchPending,
	);

	// Triage-layer context (#429): the roving focus cursor + the multi-selection,
	// bridged up from MessageList. Action verbs (archive/star/read/mute/…) target
	// the selection when one exists, else the focused row, else the open thread.
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

	// The single thread the verbs act on: the focused row, falling back to the
	// open thread. (Bulk actions over `triageSelectedIds` fan out separately.)
	const focusedThread =
		threads.find((t) => t.messageId === triageFocusedId) ?? selectedThread;

	// Auto-open intelligence pane when the selected thread has a DKIM mismatch.
	// Track the last message id we auto-opened for so we don't re-trigger on
	// subsequent renders of the same message (e.g. optimistic cache patches).
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

	// Datum unread count: prefer the mailbox's authoritative server-side
	// unseenCount over a count derived from the loaded infinite-query pages,
	// which undercounts on multi-page mailboxes and creeps as the user scrolls.
	// Fall back to the loaded-page count only when the mailbox isn't resolvable
	// yet (e.g. mailbox query still warming).
	const mailboxUnseenCount = useCurrentMailboxUnseenCount({ accounts });
	const unreadCount =
		mailboxUnseenCount ?? threads.filter((t) => !t.isRead).length;

	/* ---- toolbar wire-up: actions for the selected thread ---- */

	// Delete all messages in the open thread via the toolbar.
	const queryClient = useQueryClient();
	const { deleteMessages: toolbarDelete } = useDeleteMessages({
		mailboxId,
		threadId: selectedThread?.threadId,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});

	// Move messages in the open thread (toolbar "Move to mailbox" button).
	const { moveMessages: toolbarMove } = useMoveMessages({
		mailboxId,
		threadId: selectedThread?.threadId,
		accountId: mailboxAccountId,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});

	// Detect whether the open mailbox is the account's IMAP \Drafts special-use
	// folder. When true, we render the segmented DraftsView (Remit drafts +
	// IMAP \Drafts) in place of the flat MessageList (issue #505).
	const { draftsMailboxId } = useDraftsMailbox(mailboxAccountId);
	const isDraftsMailbox =
		draftsMailboxId !== undefined && draftsMailboxId === mailboxId;

	// Archive = move all thread messages to the archive mailbox.
	const { archiveMailboxId } = useArchiveMailbox(mailboxAccountId);
	const handleToolbarArchive = useCallback(() => {
		if (!selectedThread || !archiveMailboxId) return;
		// The thread message list is already loaded in the query cache; extract
		// all message ids from the cache so we can pass them to moveMessages.
		const threadKey = threadDetailOperationsListThreadMessagesQueryKey({
			path: { threadId: selectedThread.threadId },
		});
		const cached = queryClient.getQueriesData<{
			items: { messageId: string }[];
		}>({ queryKey: threadKey });
		const messageIds = cached.flatMap(
			([, data]) => data?.items.map((m) => m.messageId) ?? [],
		);
		if (messageIds.length > 0) {
			toolbarMove(messageIds, archiveMailboxId);
		} else {
			// Fallback: move just the representative message from the list row.
			toolbarMove([selectedThread.messageId], archiveMailboxId);
		}
	}, [selectedThread, archiveMailboxId, queryClient, toolbarMove]);

	// Delete all messages in the thread via toolbar trash button.
	const handleToolbarDelete = useCallback(() => {
		if (!selectedThread) return;
		const threadKey = threadDetailOperationsListThreadMessagesQueryKey({
			path: { threadId: selectedThread.threadId },
		});
		const cached = queryClient.getQueriesData<{
			items: { messageId: string }[];
		}>({ queryKey: threadKey });
		const messageIds = cached.flatMap(
			([, data]) => data?.items.map((m) => m.messageId) ?? [],
		);
		if (messageIds.length > 0) {
			toolbarDelete(messageIds);
		} else {
			toolbarDelete([selectedThread.messageId]);
		}
	}, [selectedThread, queryClient, toolbarDelete]);

	// Star toggle for the representative (most-recent) message in the thread.
	const { toggleStar: toolbarToggleStar } = useToggleStar({
		threadId: selectedThread?.threadId ?? "",
		mailboxId,
	});

	const handleToolbarStar = useCallback(() => {
		if (!selectedThread) return;
		toolbarToggleStar(selectedThread.messageId, selectedThread.hasStars);
	}, [selectedThread, toolbarToggleStar]);

	// Inline compose request from the toolbar — lifted up from ConversationView
	// so the top toolbar can trigger the inline compose inside the conversation.
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

	// Compose
	const { state: composeState, openCompose, closeCompose } = useCompose();

	const handleNewCompose = useCallback(() => {
		openCompose({ mode: "new" });
	}, [openCompose]);

	// Delete a Remit draft from the toolbar trash button. Only active when the
	// Drafts mailbox is open and a Remit draft (outboxMessageId) is loaded in
	// compose — the ComposeActionBar discard button covers the same action from
	// within the compose panel (#536).
	const deleteOutboxMutation = useMutation(
		outboxDetailOperationsDeleteOutboxMessageMutation(),
	);
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

	// Esc → back: deselect the open thread (close the reading pane). The
	// dispatcher routes Esc to the `back` action; `u` is now toggle read/unread.
	const goBack = useCallback(() => {
		if (selectedMessageId) {
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: (prev: MailboxSearch) => ({
					...prev,
					selectedMessageId: undefined,
				}),
			});
		}
	}, [selectedMessageId, mailboxId, navigate]);

	/* ---- triage keyboard handlers: act on the focused row (#429) ---- */

	// Resolve all loaded message ids of a thread from the thread-messages cache,
	// falling back to the representative row messageId. Shared by every
	// thread-scoped triage verb (archive / delete / junk).
	const messageIdsForThread = useCallback(
		(thread: typeof focusedThread): string[] => {
			if (!thread) return [];
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

	// Star toggle for the focused thread's representative message.
	const { toggleStar: focusedToggleStar } = useToggleStar({
		threadId: focusedThread?.threadId ?? "",
		mailboxId,
	});

	// Read/unread toggle (`u`). Bulk-capable: the list optimistic patch keys off
	// the mailbox, so flipping a set of message ids updates every selected row.
	const { toggleReadFor: triageToggleReadFor } = useToggleReadFor({
		mailboxId,
		accountId: mailboxAccountId,
	});

	// Move-to-archive / move-to-junk for the focused thread. (`archiveMailboxId`
	// is resolved once above for the toolbar; reused here.)
	const { junkMailboxId } = useJunkMailbox(mailboxAccountId);
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

	// Sender flags (mute / block / VIP) for the focused sender. Resolves the
	// address id via the same lookup the intelligence pane uses.
	const { addressId: focusedAddressId, address: focusedAddress } =
		useIntelligenceData(focusedThread);
	const { updateFlags: updateFocusedSenderFlags } = useUpdateAddressFlags({
		addressId: focusedAddressId,
		senderEmail: focusedThread?.fromEmail ?? undefined,
	});

	// reply / forward act on the OPEN reading pane (inline compose lives there);
	// when nothing is open, focus it first so the verb has a target.
	const ensureFocusedOpen = useCallback(() => {
		if (selectedMessageId || !triageFocusedId) return false;
		navigate({
			to: "/mail/$mailboxId",
			params: { mailboxId },
			search: (prev: MailboxSearch) => ({
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

	// Bulk-aware target message ids: the selection when present, else the
	// focused thread's messages.
	const triageTargetMessageIds = useCallback((): string[] => {
		if (triageSelectedIds.length > 0) return triageSelectedIds;
		return messageIdsForThread(focusedThread);
	}, [triageSelectedIds, messageIdsForThread, focusedThread]);

	const triageArchive = useCallback(() => {
		if (!archiveMailboxId) return;
		const ids = triageTargetMessageIds();
		if (ids.length > 0) triageMove(ids, archiveMailboxId);
	}, [archiveMailboxId, triageTargetMessageIds, triageMove]);

	const triageDeleteAction = useCallback(() => {
		const ids = triageTargetMessageIds();
		if (ids.length > 0) triageDelete(ids);
	}, [triageTargetMessageIds, triageDelete]);

	const triageMarkJunk = useCallback(() => {
		if (!junkMailboxId) return;
		const ids = triageTargetMessageIds();
		if (ids.length > 0) triageMove(ids, junkMailboxId);
	}, [junkMailboxId, triageTargetMessageIds, triageMove]);

	// Star (`s`) is selection-aware. With a multi-selection, flip every selected
	// row to the focused row's *inverse* star state (a single, predictable bulk
	// direction — like shift-clicking star in a desktop client); with no
	// selection it toggles just the focused thread. The list optimistic patch
	// keys off the mailbox so all selected rows update.
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

	// Read/unread (`u`) is selection-aware: flip the whole target set to the
	// inverse of the focused row's current read state (one bulk direction).
	const triageToggleRead = useCallback(() => {
		const ids = triageTargetMessageIds();
		if (ids.length === 0) return;
		const nextRead = !(focusedThread?.isRead ?? false);
		triageToggleReadFor(ids, nextRead);
	}, [triageTargetMessageIds, focusedThread, triageToggleReadFor]);

	// Sender verbs (mute / VIP) act on the focused SENDER, not per-message, so
	// they intentionally ignore the row multi-selection — `m`/`v` mute or VIP
	// the one focused sender (a `PATCH /addresses/{id}`). Bulk sender actions
	// over a mixed-sender selection are a separate bulk-bar affordance (the
	// "Mute sender (N selected)" verb in 04-triage.md), out of scope here.
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

	// Block is destructive (a confirm is wired in the intelligence pane); from
	// the keyboard we open the intelligence sidebar on the focused sender so the
	// confirm path is reached rather than silently blocking.
	// TODO(#429): inline block-confirm dialog for the keyboard path.
	const triageBlock = useCallback(() => {
		if (!intelligenceOpen) onToggleIntelligence();
	}, [intelligenceOpen, onToggleIntelligence]);

	// `g i/s/f` go-to: resolve the special-use mailbox of the current account.
	// Brief and settings have real routes; inbox/sent/flagged resolve from the
	// loaded mailbox list where possible.
	// TODO(#426): `g b` lands on the daily-brief route once it ships its own path.
	const goToRoute = useCallback(
		(to: "/mail" | "/settings") => {
			navigate({ to });
		},
		[navigate],
	);

	// Central global dispatcher (#429): one keydown handler routing every key to
	// the handler table. Paused while compose owns the keyboard (compose has its
	// own Esc handler below). The list-local j/k/Enter/x/Shift+arrow/Delete/d
	// keys live in MessageList; this layer owns the verbs + global keys with no
	// overlap.
	useTriageKeyboard({
		enabled: !composeState.isOpen,
		handlers: {
			// openFocused (Enter), focusNext/Previous (j/k), toggleSelect (x),
			// extendSelect (Shift+j/k), the Delete/Backspace confirm-delete and
			// toggleDensity (d) are owned by MessageList's list-local listeners.
			// `#` here is the direct move-to-Trash verb (optimistic, like the
			// toolbar trash button); Delete/Backspace keep their confirm dialog.
			back: goBack,
			reply: triageReply,
			replyAll: triageReplyAll,
			forward: triageForward,
			archive: triageArchive,
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
			goFlagged: () => goToRoute("/mail"),
			goSettings: () => goToRoute("/settings"),
		},
	});

	useKeyboardNavigation({
		enabled: composeState.isOpen,
		bindings: [{ key: "Escape", handler: closeCompose, preventDefault: true }],
	});

	// When the open mailbox is the account's \Drafts special-use folder, render
	// the segmented DraftsView. Otherwise render the flat MessageList as usual.
	// The IMAP threads are already loaded by the infinite query above — pass them
	// directly to avoid a second fetch (issue #505).
	const messageList =
		isDraftsMailbox && mailboxAccountId ? (
			<DraftsView
				mailboxId={mailboxId}
				accountId={mailboxAccountId}
				selectedMessageId={selectedMessageId}
				imapThreads={threads}
				title={mailboxName ?? "Drafts"}
				unreadCount={mailboxUnseenCount ?? undefined}
			/>
		) : (
			<MessageList
				mailboxId={mailboxId}
				threads={threads}
				selectedMessageId={selectedMessageId}
				isLoading={isLoading}
				isError={isError}
				error={error}
				onRetry={() => refetch()}
				searchQuery={searchQuery}
				onDeleteMessages={handleDeleteMessages}
				onMoveMessages={handleMoveMessages}
				isDeleting={isDeleting}
				isMoving={isMoving}
				onLoadMore={fetchNextPage}
				hasMore={hasNextPage}
				isLoadingMore={isFetchingNextPage}
				accountId={mailboxAccountId}
				onTriageContextChange={handleTriageContextChange}
			/>
		);

	const detailPane =
		composeState.isOpen && !selectedThread ? (
			<FullCompose />
		) : selectedThread ? (
			<ConversationView
				threadId={selectedThread.threadId}
				mailboxId={mailboxId}
				subject={selectedThread.subject}
				authenticity={selectedThread.authenticity}
				onOpenIntelligence={
					selectedThread.authenticity?.dkimMismatch
						? onToggleIntelligence
						: undefined
				}
				composeRequest={toolbarComposeRequest}
				onComposeClose={handleClearComposeRequest}
			/>
		) : (
			<div className="flex h-full items-center justify-center">
				<EmptyState message="Select a message to read" />
			</div>
		);

	// Mobile: single-pane view that swaps based on `selectedMessageId` and
	// compose state. The compose surface, when open without a selected
	// thread, takes over the whole pane (which on mobile IS the whole
	// screen) — no extra overlay plumbing required. The thread view
	// flows naturally; back/reply/forward affordances live in the
	// `ConversationView` action bar (mobile branch).
	if (!isDesktop) {
		const showCompose = composeState.isOpen && !selectedThread;
		if (selectedThread) {
			return (
				<ConversationView
					threadId={selectedThread.threadId}
					mailboxId={mailboxId}
					subject={selectedThread.subject}
					onBack={goBack}
				/>
			);
		}
		if (showCompose) {
			return <div className="h-full">{detailPane}</div>;
		}
		const accountId = accounts[0]?.accountId;
		if (accountId) {
			return (
				<div className="h-full">
					<PullToRefresh accountId={accountId}>{messageList}</PullToRefresh>
				</div>
			);
		}
		return <div className="h-full">{messageList}</div>;
	}

	// Desktop: panes 2–4 of the AppShell model (#422) — message list,
	// reading pane (its datum row is the message toolbar) and the
	// intelligence sidebar (collapsed by default, toggled from the toolbar).
	// Nested resizable group: the nav↔content boundary is owned by the
	// parent layout; the boundaries here carry the same hairline handles, so
	// the user sees one continuous set of drag handles between all four panes.
	const hasThread = Boolean(selectedThread);
	// A Remit draft is "active" when the Drafts mailbox is open and compose is
	// showing an outbox message with no IMAP thread selected (#536).
	const hasRemitDraftOpen =
		isDraftsMailbox &&
		composeState.isOpen &&
		!!composeState.outboxMessageId &&
		!selectedThread;
	const listTitle = mailboxName ?? "Inbox";
	// Pane 4 only renders when intelligence is toggled on AND a thread is open
	// (it's contextual to the open message — matches the remit-ui AppShell
	// reference, which gates on `intelligenceOpen && thread`). The toolbar's
	// info toggle is likewise hidden until a thread is selected, so it never
	// opens an empty rail.
	const showIntelligence = intelligenceOpen && hasThread;
	return (
		<ResizablePanelGroup direction="horizontal">
			<ResizablePanel
				id="message-list"
				order={1}
				defaultSize={showIntelligence ? 30 : 33}
				minSize={20}
				maxSize={48}
				className="min-w-0"
			>
				{/* DraftsView renders its own datum header (self-chrome), like
				    DailyBrief on the /mail index — render it directly in the panel
				    rather than nesting it inside the wrapping <section>+header,
				    which would stack two identical datum bars (#505). The flat
				    MessageList renders no chrome and relies on this outer header. */}
				{isDraftsMailbox && mailboxAccountId ? (
					messageList
				) : (
					<section className="flex h-full w-full flex-col bg-surface">
						{/* List datum bar (40px, the shared `--spacing-pane-header`):
						    the list's context — mailbox title + unread count — lives on
						    the datum, its bottom hairline on the same y as the message
						    toolbar and intelligence rail header so one continuous grid
						    line runs across panes 2–4 (no staircase). Search moved to
						    the message toolbar but still filters this list. */}
						<header className="flex h-pane-header shrink-0 items-center justify-between gap-2 border-b border-line px-row-inset">
							<h1 className="truncate text-sm font-semibold text-fg">
								{listTitle}
							</h1>
							{unreadCount > 0 && (
								<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
									{unreadCount} unread
								</span>
							)}
						</header>
						<div className="min-h-0 flex-1 overflow-hidden">{messageList}</div>
					</section>
				)}
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel id="reading" order={2} minSize={24} className="min-w-0">
				{/* Pane wrapper is a <section>, not an <article>: the message
				    content (ConversationView) already renders the sole `article`
				    role. A second nested article breaks `getByRole("article")` in
				    the smoke suite (strict-mode "resolved to 2 elements"). */}
				<section className="flex h-full w-full min-w-0 flex-col bg-canvas">
					<MessageToolbar
						hasThread={hasThread}
						onCompose={handleNewCompose}
						intelligenceOpen={showIntelligence}
						showIntelligenceToggle={hasThread}
						onToggleIntelligence={onToggleIntelligence}
						searchValue={searchInput}
						onSearchChange={onSearchChange}
						onSearchClear={onSearchClear}
						onSearchClearQuery={onSearchClearQuery}
						onReply={hasThread ? handleToolbarReply : undefined}
						onReplyAll={hasThread ? handleToolbarReplyAll : undefined}
						onForward={hasThread ? handleToolbarForward : undefined}
						onArchive={
							hasThread && archiveMailboxId ? handleToolbarArchive : undefined
						}
						canArchive={Boolean(archiveMailboxId)}
						canDelete={hasThread || hasRemitDraftOpen}
						onDelete={
							hasThread
								? handleToolbarDelete
								: hasRemitDraftOpen
									? handleToolbarDiscardDraft
									: undefined
						}
						onToggleStar={hasThread ? handleToolbarStar : undefined}
						isStarred={selectedThread?.hasStars}
						moveContext={
							hasThread && mailboxAccountId
								? {
										accountId: mailboxAccountId,
										currentMailboxId: mailboxId,
										onMove: (destMailboxId) => {
											if (!selectedThread) return;
											const threadKey =
												threadDetailOperationsListThreadMessagesQueryKey({
													path: { threadId: selectedThread.threadId },
												});
											const cached = queryClient.getQueriesData<{
												items: { messageId: string }[];
											}>({ queryKey: threadKey });
											const messageIds = cached.flatMap(
												([, data]) => data?.items.map((m) => m.messageId) ?? [],
											);
											if (messageIds.length > 0) {
												toolbarMove(messageIds, destMailboxId);
											} else {
												toolbarMove([selectedThread.messageId], destMailboxId);
											}
										},
									}
								: undefined
						}
					/>
					<div className="min-h-0 flex-1 overflow-hidden">{detailPane}</div>
				</section>
			</ResizablePanel>
			{showIntelligence && (
				<>
					<ResizableHandle />
					<ResizablePanel
						id="intelligence"
						order={3}
						defaultSize={21}
						minSize={15}
						maxSize={32}
						className="min-w-0"
					>
						<IntelligencePane
							onClose={onToggleIntelligence}
							thread={selectedThread}
							mailboxId={mailboxId}
							accountId={mailboxAccountId}
						/>
					</ResizablePanel>
				</>
			)}
		</ResizablePanelGroup>
	);
}
