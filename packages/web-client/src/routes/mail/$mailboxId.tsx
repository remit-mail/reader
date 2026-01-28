import {
	messageBulkOperationsDeleteMessagesMutation,
	threadOperationsListThreadsOptions,
	threadOperationsSearchThreadsOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

	const listOptions = threadOperationsListThreadsOptions({
		path: { mailboxId },
		query: { order: "desc" },
	});

	const searchOptions = threadOperationsSearchThreadsOptions({
		path: { mailboxId },
		query: { order: "desc", query: searchQuery.trim() },
	});

	// Choose the appropriate query based on whether we're searching
	const queryOptions = hasSearchQuery ? searchOptions : listOptions;

	const { data: threadsResponse, isLoading } = useQuery({
		...queryOptions,
		// Disable search query when there's no search term
		enabled: hasSearchQuery ? searchQuery.trim().length > 0 : true,
	});

	// Delete mutation with optimistic updates
	const deleteMutation = useMutation({
		...messageBulkOperationsDeleteMessagesMutation(),
		onMutate: async (variables) => {
			const messageIds = new Set(variables.body.messageIds);

			// Cancel any outgoing refetches
			await queryClient.cancelQueries({ queryKey: queryOptions.queryKey });

			// Snapshot the previous value
			const previousData = queryClient.getQueryData(queryOptions.queryKey);

			// Optimistically update to remove deleted messages
			queryClient.setQueryData(
				queryOptions.queryKey,
				(old: { items: RemitImapThreadMessageResponse[] } | undefined) => {
					if (!old) return old;
					return {
						...old,
						items: old.items.filter((item) => !messageIds.has(item.messageId)),
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
				queryClient.setQueryData(queryOptions.queryKey, context.previousData);
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
			queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
		},
	});

	const handleDeleteMessages = useCallback(
		(messageIds: string[]) => {
			deleteMutation.mutate({ body: { messageIds } });
		},
		[deleteMutation],
	);

	// Threads from API response (search handled by backend)
	const threads = threadsResponse?.items ?? [];

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
