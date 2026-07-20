/**
 * The starred listing — `GET /threads?starred=true`, served by the `byStarred`
 * index — as one hook, so the Starred pane's list and its selection resolve
 * from the same query.
 *
 * The two are the same cache entry, not two requests: they share a query key,
 * so `threads` here is exactly the set of rows the list rendered. Resolving a
 * selection from any other listing reintroduces issue #70 — the INBOX-scoped
 * unified listing cannot see a starred thread filed elsewhere, so its row is
 * clickable but resolves to nothing and no reading pane opens.
 */
import { unifiedThreadOperationsListAllThreadsQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { unifiedThreadOperationsListAllThreads } from "@remit/api-http-client/sdk.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export const starredThreadsQueryKey = () =>
	unifiedThreadOperationsListAllThreadsQueryKey({
		query: { starred: true, order: "desc" },
	});

interface StarredThreads {
	/** Every starred thread across the pages loaded so far, newest first. */
	threads: RemitImapThreadMessageResponse[];
	isLoading: boolean;
	isError: boolean;
	error: unknown;
	refetch: () => void;
	fetchNextPage: () => void;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
}

export function useStarredThreads(): StarredThreads {
	const {
		data,
		isLoading,
		isError,
		error,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useInfiniteQuery({
		queryKey: starredThreadsQueryKey(),
		queryFn: async ({ pageParam }) => {
			const { data: page } = await unifiedThreadOperationsListAllThreads({
				query: {
					starred: true,
					order: "desc",
					continuationToken: pageParam,
				},
				throwOnError: true,
			});
			return page;
		},
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.continuationToken,
		staleTime: 60_000,
	});

	const threads = useMemo(
		() => (data?.pages ?? []).flatMap((page) => page.items ?? []),
		[data],
	);

	return {
		threads,
		isLoading,
		isError,
		error,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	};
}
