import { messageBulkOperationsUpdateFlagsMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { threadKeys } from "./queries/keys";

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
		...messageBulkOperationsUpdateFlagsMutation(),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: threadKeys.messages(threadId),
			});
			queryClient.invalidateQueries({
				queryKey: threadKeys.list(mailboxId, {}),
				exact: false,
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
			body: {
				messageIds: [messageId],
				isStarred: !currentlyStarred,
			},
		});
	};

	return {
		toggleStar,
		isPending,
		pendingMessageId: isPending ? variables?.body.messageIds[0] : undefined,
	};
};
