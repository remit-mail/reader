import {
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
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { z } from "zod";
import type { ComposeMode } from "@/components/compose/ComposeProvider";
import { useCompose } from "@/components/compose/ComposeProvider";
import { FullCompose } from "@/components/compose/FullCompose";
import { ConversationView } from "@/components/mail/ConversationView";
import { IntelligencePane } from "@/components/mail/IntelligencePane";
import { MessageList } from "@/components/mail/MessageList";
import { MessageToolbar } from "@/components/mail/MessageToolbar";
import { PullToRefresh } from "@/components/mail/PullToRefresh";
import { EmptyState } from "@/components/ui/EmptyState";
import { useArchiveMailbox } from "@/hooks/useArchiveMailbox";
import {
	useCurrentMailboxName,
	useCurrentMailboxUnseenCount,
} from "@/hooks/useCurrentMailboxName";
import {
	dropDeletedThreads,
	useDeleteMessages,
} from "@/hooks/useDeleteMessages";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useToggleStar } from "@/hooks/useToggleStar";
import { useMailContext } from "@/lib/mail-context";
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
	const { selectedMessageId, q: searchQuery = "" } = Route.useSearch();
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();
	const {
		accounts,
		searchInput,
		onSearchChange,
		onSearchClear,
		intelligenceOpen,
		onToggleIntelligence,
	} = useMailContext();

	// Use search API when there's a query, otherwise list API. The query is
	// normalized (trim + locale-aware lowercase) before it leaves the client
	// so equivalent searches collide on the same React Query cache entry and
	// the backend comparison is case-insensitive. The display value
	// (`searchQuery`) keeps the user's original casing in the input + the
	// "results for X" header.
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

	const selectedThread = threads.find((t) => t.messageId === selectedMessageId);

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

	// "u" to go back (deselect current thread)
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

	useKeyboardNavigation({
		enabled: !!selectedMessageId && !composeState.isOpen,
		bindings: [
			{ key: "u", handler: goBack, preventDefault: true },
			{ key: "Escape", handler: goBack, preventDefault: true },
		],
	});

	useKeyboardNavigation({
		enabled: !composeState.isOpen,
		bindings: [{ key: "c", handler: handleNewCompose, preventDefault: true }],
	});

	useKeyboardNavigation({
		enabled: composeState.isOpen,
		bindings: [{ key: "Escape", handler: closeCompose, preventDefault: true }],
	});

	const messageList = (
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
				composeRequest={toolbarComposeRequest}
				onComposeClose={handleClearComposeRequest}
			/>
		) : (
			<div className="flex h-full items-center justify-center">
				<EmptyState
					message={
						searchQuery
							? "No messages match your search"
							: "Select a message to read"
					}
				/>
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
						onReply={hasThread ? handleToolbarReply : undefined}
						onReplyAll={hasThread ? handleToolbarReplyAll : undefined}
						onForward={hasThread ? handleToolbarForward : undefined}
						onArchive={
							hasThread && archiveMailboxId ? handleToolbarArchive : undefined
						}
						canArchive={Boolean(archiveMailboxId)}
						onDelete={hasThread ? handleToolbarDelete : undefined}
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
						<IntelligencePane onClose={onToggleIntelligence} />
					</ResizablePanel>
				</>
			)}
		</ResizablePanelGroup>
	);
}
