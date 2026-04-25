import {
	messageOperationsUpdateMessageFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
	threadOperationsListThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface UseToggleStarOptions {
	threadId: string;
	mailboxId: string;
}

interface ThreadMessagesData {
	items: RemitImapThreadMessageResponse[];
	[key: string]: unknown;
}

interface ThreadsListPage {
	items: RemitImapThreadMessageResponse[];
	[key: string]: unknown;
}

interface ThreadsListData {
	pages: ThreadsListPage[];
	pageParams: Array<string | undefined>;
}

interface ToggleStarContext {
	threadMessagesKey: ReturnType<
		typeof threadDetailOperationsListThreadMessagesQueryKey
	>;
	threadsListKey: ReturnType<typeof threadOperationsListThreadsQueryKey>;
	previousThreadMessages?: ThreadMessagesData;
	previousThreadsList?: ThreadsListData;
}

const toggleStarsInItems = (
	items: RemitImapThreadMessageResponse[],
	messageId: string,
	nextStarred: boolean,
): RemitImapThreadMessageResponse[] =>
	items.map((item) =>
		item.messageId === messageId ? { ...item, hasStars: nextStarred } : item,
	);

export const useToggleStar = ({
	threadId,
	mailboxId,
}: UseToggleStarOptions) => {
	const queryClient = useQueryClient();

	const { mutate, isPending, variables } = useMutation({
		...messageOperationsUpdateMessageFlagsMutation(),
		onMutate: async (vars): Promise<ToggleStarContext> => {
			const messageId = vars.path.messageId;
			const nextStarred = vars.body.isStarred ?? false;

			const threadMessagesKey =
				threadDetailOperationsListThreadMessagesQueryKey({
					path: { threadId },
				});
			const threadsListKey = threadOperationsListThreadsQueryKey({
				path: { mailboxId },
			});

			await Promise.all([
				queryClient.cancelQueries({ queryKey: threadMessagesKey }),
				queryClient.cancelQueries({ queryKey: threadsListKey }),
			]);

			const previousThreadMessages =
				queryClient.getQueryData<ThreadMessagesData>(threadMessagesKey);
			const previousThreadsList =
				queryClient.getQueryData<ThreadsListData>(threadsListKey);

			if (previousThreadMessages) {
				queryClient.setQueryData<ThreadMessagesData>(threadMessagesKey, {
					...previousThreadMessages,
					items: toggleStarsInItems(
						previousThreadMessages.items,
						messageId,
						nextStarred,
					),
				});
			}

			if (previousThreadsList) {
				queryClient.setQueryData<ThreadsListData>(threadsListKey, {
					...previousThreadsList,
					pages: previousThreadsList.pages.map((page) => ({
						...page,
						items: toggleStarsInItems(page.items, messageId, nextStarred),
					})),
				});
			}

			return {
				threadMessagesKey,
				threadsListKey,
				previousThreadMessages,
				previousThreadsList,
			};
		},
		onError: (_err, _vars, context) => {
			if (!context) return;
			if (context.previousThreadMessages) {
				queryClient.setQueryData(
					context.threadMessagesKey,
					context.previousThreadMessages,
				);
			}
			if (context.previousThreadsList) {
				queryClient.setQueryData(
					context.threadsListKey,
					context.previousThreadsList,
				);
			}
		},
		onSettled: (_data, _err, _vars, context) => {
			if (!context) return;
			queryClient.invalidateQueries({ queryKey: context.threadMessagesKey });
			queryClient.invalidateQueries({ queryKey: context.threadsListKey });
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
