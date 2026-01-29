import {
	messageOperationsUpdateMessageFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
	threadOperationsListThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface UseToggleStarOptions {
	threadId: string;
	mailboxId: string;
}

export const useToggleStar = ({
	threadId,
	mailboxId,
}: UseToggleStarOptions) => {
	const queryClient = useQueryClient();

	const { mutate, isPending, variables } = useMutation({
		...messageOperationsUpdateMessageFlagsMutation(),
		onSuccess: (_data, variables) => {
			// Invalidate thread messages query using generated key
			queryClient.invalidateQueries({
				queryKey: threadDetailOperationsListThreadMessagesQueryKey({
					path: { threadId },
				}),
			});
			// Invalidate thread list query using generated key
			queryClient.invalidateQueries({
				queryKey: threadOperationsListThreadsQueryKey({
					path: { mailboxId },
				}),
			});
			const action = variables.body.isStarred ? "starred" : "unstarred";
			toast.success(`Message ${action}`);
		},
		onError: (error) => {
			console.error("Failed to update star:", error);
			toast.error("Failed to update star");
		},
	});

	const toggleStar = (messageId: string, currentlyStarred: boolean) => {
		mutate({
			path: { messageId },
			body: {
				isStarred: !currentlyStarred,
			},
		});
	};

	return {
		toggleStar,
		isPending,
		pendingMessageId: isPending ? variables?.path.messageId : undefined,
	};
};
