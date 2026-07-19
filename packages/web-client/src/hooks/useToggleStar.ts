import {
	messageOperationsUpdateMessageFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
	unifiedThreadOperationsListAllThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";

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

interface SnapshotEntry<T> {
	queryKey: readonly unknown[];
	data: T;
}

interface ToggleStarContext {
	threadMessagesPrefix: readonly unknown[];
	threadsListPrefix: readonly unknown[];
	threadsSearchPrefix: readonly unknown[];
	unifiedThreadsPrefix: readonly unknown[];
	previousThreadMessages: SnapshotEntry<ThreadMessagesData>[];
	previousThreadsList: SnapshotEntry<ThreadsListData>[];
	previousUnifiedThreads: SnapshotEntry<ThreadMessagesData>[];
}

export const toggleStarsInItems = (
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
	const { pushError } = useErrorBanners();

	const { mutate, isPending, variables } = useMutation({
		...messageOperationsUpdateMessageFlagsMutation(),
		onMutate: async (vars): Promise<ToggleStarContext> => {
			const messageId = vars.path.messageId;
			const nextStarred = vars.body.isStarred ?? false;

			// Use partial-key prefixes so the cancel/snapshot/patch covers the
			// full key (which includes query options like { order: "desc",
			// mailboxId }) without us having to enumerate every variant. React
			// Query matches by prefix on the first key element.
			const threadMessagesPrefix =
				threadDetailOperationsListThreadMessagesQueryKey({
					path: { threadId },
				});
			const threadsListPrefix = threadOperationsListThreadsQueryKey({
				path: { mailboxId },
			});
			const threadsSearchPrefix = threadOperationsSearchThreadsQueryKey({
				path: { mailboxId },
			});
			// The unified cross-account listing backs the daily brief and the
			// Starred mailbox, so a star toggled from an inbox has to land there
			// too — without this the starred view keeps serving a stale page for
			// its whole staleTime and the message never appears.
			const unifiedThreadsPrefix =
				unifiedThreadOperationsListAllThreadsQueryKey();

			await Promise.all([
				queryClient.cancelQueries({ queryKey: threadMessagesPrefix }),
				queryClient.cancelQueries({ queryKey: threadsListPrefix }),
				queryClient.cancelQueries({ queryKey: threadsSearchPrefix }),
				queryClient.cancelQueries({ queryKey: unifiedThreadsPrefix }),
			]);

			const previousThreadMessages = queryClient
				.getQueriesData<ThreadMessagesData>({ queryKey: threadMessagesPrefix })
				.filter(
					(entry): entry is [readonly unknown[], ThreadMessagesData] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			const previousThreadsList = queryClient
				.getQueriesData<ThreadsListData>({ queryKey: threadsListPrefix })
				.concat(
					queryClient.getQueriesData<ThreadsListData>({
						queryKey: threadsSearchPrefix,
					}),
				)
				.filter(
					(entry): entry is [readonly unknown[], ThreadsListData] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			const previousUnifiedThreads = queryClient
				.getQueriesData<ThreadMessagesData>({ queryKey: unifiedThreadsPrefix })
				.filter(
					(entry): entry is [readonly unknown[], ThreadMessagesData] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			const patchItemsData = (old: ThreadMessagesData | undefined) => {
				if (!old) return old;
				return {
					...old,
					items: toggleStarsInItems(old.items, messageId, nextStarred),
				};
			};

			queryClient.setQueriesData<ThreadMessagesData>(
				{ queryKey: threadMessagesPrefix },
				patchItemsData,
			);
			queryClient.setQueriesData<ThreadMessagesData>(
				{ queryKey: unifiedThreadsPrefix },
				patchItemsData,
			);

			const patchListData = (old: ThreadsListData | undefined) => {
				if (!old) return old;
				return {
					...old,
					pages: old.pages.map((page) => ({
						...page,
						items: toggleStarsInItems(page.items, messageId, nextStarred),
					})),
				};
			};

			queryClient.setQueriesData<ThreadsListData>(
				{ queryKey: threadsListPrefix },
				patchListData,
			);
			queryClient.setQueriesData<ThreadsListData>(
				{ queryKey: threadsSearchPrefix },
				patchListData,
			);

			return {
				threadMessagesPrefix,
				threadsListPrefix,
				threadsSearchPrefix,
				unifiedThreadsPrefix,
				previousThreadMessages,
				previousThreadsList,
				previousUnifiedThreads,
			};
		},
		onError: (err, vars, context) => {
			if (context) {
				for (const entry of context.previousThreadMessages) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
				for (const entry of context.previousThreadsList) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
				for (const entry of context.previousUnifiedThreads) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
			}
			const nextStarred = vars.body.isStarred ?? false;
			pushError({
				title: nextStarred
					? "Couldn't star message"
					: "Couldn't unstar message",
				detail: formatErrorDetail(err),
			});
		},
		onSettled: (_data, _err, _vars, context) => {
			if (!context) return;
			queryClient.invalidateQueries({ queryKey: context.threadMessagesPrefix });
			queryClient.invalidateQueries({ queryKey: context.threadsListPrefix });
			queryClient.invalidateQueries({ queryKey: context.threadsSearchPrefix });
			queryClient.invalidateQueries({ queryKey: context.unifiedThreadsPrefix });
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
