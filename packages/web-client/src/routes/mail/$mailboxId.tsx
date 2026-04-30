import {
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	threadOperationsListThreads,
	threadOperationsSearchThreads,
} from "@remit/api-http-client/sdk.gen.ts";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import { useCompose } from "@/components/compose/ComposeProvider";
import { FullCompose } from "@/components/compose/FullCompose";
import { Panel } from "@/components/layout/Panel";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/layout/Resizable";
import { ConversationView } from "@/components/mail/ConversationView";
import { MessageList } from "@/components/mail/MessageList";
import { PullToRefresh } from "@/components/mail/PullToRefresh";
import { EmptyState } from "@/components/ui/EmptyState";
import {
	dropDeletedThreads,
	useDeleteMessages,
} from "@/hooks/useDeleteMessages";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useMailContext } from "@/routes/mail";

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
	const { accounts } = useMailContext();

	// Use search API when there's a query, otherwise list API
	const hasSearchQuery = searchQuery.trim().length > 0;

	// Query key for cache management
	const queryKey = hasSearchQuery
		? threadOperationsSearchThreadsQueryKey({
				path: { mailboxId },
				query: { order: "desc", query: searchQuery.trim() },
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
						query: searchQuery.trim(),
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
		enabled: hasSearchQuery ? searchQuery.trim().length > 0 : true,
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

	// Desktop: unchanged two-pane resizable layout.
	return (
		<ResizablePanelGroup
			direction="horizontal"
			className="h-full"
			autoSaveId="remit-mailbox-pane"
		>
			<ResizablePanel id="message-list" order={1} defaultSize={35} minSize={10}>
				<Panel className="h-full">{messageList}</Panel>
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel id="detail" order={2} defaultSize={65} minSize={20}>
				<Panel withBorder={false} className="h-full">
					{detailPane}
				</Panel>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
