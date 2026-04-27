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
import { EmptyState } from "@/components/ui/EmptyState";
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useIsDesktop } from "@/hooks/useMediaQuery";

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

	// Flatten threads from all pages
	const threads = threadsData?.pages.flatMap((page) => page.items) ?? [];

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
			isDeleting={isDeleting}
			onLoadMore={fetchNextPage}
			hasMore={hasNextPage}
			isLoadingMore={isFetchingNextPage}
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
