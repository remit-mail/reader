import {
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
	unifiedThreadOperationsListAllThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type { QueryClient } from "@tanstack/react-query";
import { patchThreadListCache, type ThreadListCache } from "./thread-cache.js";

export interface SnapshotEntry<T> {
	queryKey: readonly unknown[];
	data: T;
}

export type ThreadListSnapshotEntry = SnapshotEntry<ThreadListCache>;

/** A cached page of one thread's messages, as the thread-detail endpoint serves it. */
export interface ThreadMessagesData {
	items: RemitImapThreadMessageResponse[];
	[key: string]: unknown;
}

/**
 * The rollback state an optimistic thread mutation captures in `onMutate`.
 *
 * The shape belongs to the snapshot/restore helpers below rather than to any
 * one mutation, so mark-read, star, delete and move all carry the same one
 * (#868).
 */
export interface ThreadMutationContext {
	threadMessagesPrefix: readonly unknown[];
	listPrefixes: ReadonlyArray<readonly unknown[]>;
	previousThreadMessages: SnapshotEntry<ThreadMessagesData>[];
	previousThreadsList: ThreadListSnapshotEntry[];
}

/**
 * Every cached thread listing the given mailboxes feed, as query-key prefixes:
 * each mailbox's list and search caches, plus the unified cross-account listing
 * that backs the daily brief and the Flagged view.
 *
 * A thread-list mutation (mark read, star, delete, move) has to reach all of
 * them. When a hook hand-copies a subset, a view reading from a listing it
 * forgot serves a stale page until reload: the daily brief kept its unread dot
 * after a message was read because the read mutation patched the per-mailbox
 * caches but not the unified one (#140). This is the single source every
 * mutation hook resolves its keys from, so the set can never drift between them
 * (part of #149). React Query matches by prefix, so each key also covers its
 * option variants (order, pagination) without enumerating them.
 */
export const threadListCacheKeys = (
	mailboxIds: Iterable<string>,
): ReadonlyArray<readonly unknown[]> => {
	const keys: Array<readonly unknown[]> = [];
	for (const mailboxId of new Set(mailboxIds)) {
		keys.push(threadOperationsListThreadsQueryKey({ path: { mailboxId } }));
		keys.push(threadOperationsSearchThreadsQueryKey({ path: { mailboxId } }));
	}
	keys.push(unifiedThreadOperationsListAllThreadsQueryKey());
	return keys;
};

export const cancelThreadListQueries = (
	queryClient: QueryClient,
	prefixes: ReadonlyArray<readonly unknown[]>,
): Promise<unknown> =>
	Promise.all(
		prefixes.map((queryKey) => queryClient.cancelQueries({ queryKey })),
	);

export const snapshotThreadListQueries = (
	queryClient: QueryClient,
	prefixes: ReadonlyArray<readonly unknown[]>,
): ThreadListSnapshotEntry[] =>
	prefixes
		.flatMap((queryKey) =>
			queryClient.getQueriesData<ThreadListCache>({ queryKey }),
		)
		.filter(
			(entry): entry is [readonly unknown[], ThreadListCache] =>
				entry[1] !== undefined,
		)
		.map(([queryKey, data]) => ({ queryKey, data }));

/**
 * Run `patchItems` over every cached listing under `prefixes`, whichever shape
 * each holds — the shape-tolerant `patchThreadListCache` covers both the
 * single-shot page (brief) and the infinite query (Flagged, mailbox list).
 */
export const patchThreadListQueries = (
	queryClient: QueryClient,
	prefixes: ReadonlyArray<readonly unknown[]>,
	patchItems: (
		items: RemitImapThreadMessageResponse[],
	) => RemitImapThreadMessageResponse[],
): void => {
	const updater = (old: unknown) => patchThreadListCache(old, patchItems);
	for (const queryKey of prefixes) {
		queryClient.setQueriesData({ queryKey }, updater);
	}
};

export const restoreThreadListQueries = (
	queryClient: QueryClient,
	snapshot: ThreadListSnapshotEntry[],
): void => {
	for (const entry of snapshot) {
		queryClient.setQueryData(entry.queryKey, entry.data);
	}
};

export const invalidateThreadListQueries = (
	queryClient: QueryClient,
	prefixes: ReadonlyArray<readonly unknown[]>,
): void => {
	for (const queryKey of prefixes) {
		queryClient.invalidateQueries({ queryKey });
	}
};
