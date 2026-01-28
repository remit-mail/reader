import {
	messageBulkOperationsDeleteMessagesMutation,
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	threadOperationsListThreads,
	threadOperationsSearchThreads,
} from "@remit/api-http-client/sdk.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Panel } from "@/components/layout/Panel";
import { ConversationView } from "@/components/mail/ConversationView";
import { MessageList } from "@/components/mail/MessageList";
import { EmptyState } from "@/components/ui/EmptyState";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";

// Search schema includes q from parent route for proper inheritance
const mailboxSearchSchema = z.object({
	selectedMessageId: z.string().optional(),
	q: z.string().optional(),
});

export const Route = createFileRoute("/mail/$mailboxId")({
	component: MailboxView,
	validateSearch: mailboxSearchSchema,
});

function MailboxView() {
	const { mailboxId } = Route.useParams();
	const { selectedMessageId, q: searchQuery = "" } = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

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
	});

	// Delete mutation with optimistic updates
	const deleteMutation = useMutation({
		...messageBulkOperationsDeleteMessagesMutation(),
		onMutate: async (variables) => {
			const messageIds = new Set(variables.body.messageIds);

			// Cancel any outgoing refetches
			await queryClient.cancelQueries({ queryKey });

			// Snapshot the previous value
			const previousData = queryClient.getQueryData(queryKey);

			// Optimistically update to remove deleted messages from all pages
			queryClient.setQueryData(
				queryKey,
				(
					old:
						| {
								pages: Array<{ items: RemitImapThreadMessageResponse[] }>;
								pageParams: Array<string | undefined>;
						  }
						| undefined,
				) => {
					if (!old) return old;
					return {
						...old,
						pages: old.pages.map((page) => ({
							...page,
							items: page.items.filter(
								(item) => !messageIds.has(item.messageId),
							),
						})),
					};
				},
			);

			// Clear selection if currently selected message is being deleted
			if (selectedMessageId && messageIds.has(selectedMessageId)) {
				navigate({
					to: "/mail/$mailboxId",
					params: { mailboxId },
					search: (prev) => ({ ...prev, selectedMessageId: undefined }),
				});
			}

			return { previousData };
		},
		onError: (_err, _variables, context) => {
			// Rollback on error
			if (context?.previousData) {
				queryClient.setQueryData(queryKey, context.previousData);
			}
			toast.error("Failed to delete messages");
		},
		onSuccess: (data) => {
			toast.success(
				`${data.successCount} ${data.successCount === 1 ? "message" : "messages"} deleted`,
			);
		},
		onSettled: () => {
			// Always refetch after error or success
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const handleDeleteMessages = useCallback(
		(messageIds: string[]) => {
			deleteMutation.mutate({ body: { messageIds } });
		},
		[deleteMutation],
	);

	// Flatten threads from all pages
	const threads = threadsData?.pages.flatMap((page) => page.items) ?? [];

	const selectedThread = threads.find((t) => t.messageId === selectedMessageId);

	// "u" to go back (deselect current thread)
	const goBack = useCallback(() => {
		if (selectedMessageId) {
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: (prev) => ({ ...prev, selectedMessageId: undefined }),
			});
		}
	}, [selectedMessageId, mailboxId, navigate]);

	useKeyboardNavigation({
		enabled: !!selectedMessageId,
		bindings: [
			{ key: "u", handler: goBack, preventDefault: true },
			{ key: "Escape", handler: goBack, preventDefault: true },
		],
	});

	return (
		<>
			<Panel className="w-[360px] shrink-0">
				<MessageList
					mailboxId={mailboxId}
					threads={threads}
					selectedMessageId={selectedMessageId}
					isLoading={isLoading}
					searchQuery={searchQuery}
					onDeleteMessages={handleDeleteMessages}
					isDeleting={deleteMutation.isPending}
					onLoadMore={fetchNextPage}
					hasMore={hasNextPage}
					isLoadingMore={isFetchingNextPage}
				/>
			</Panel>
			<Panel withBorder={false} className="flex-1">
				{selectedThread ? (
					<ConversationView
						threadId={selectedThread.threadId}
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
				)}
			</Panel>
		</>
	);
}
