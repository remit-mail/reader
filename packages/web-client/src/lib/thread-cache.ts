import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";

/**
 * Optimistic patching of the thread caches.
 *
 * `queryClient.setQueriesData({ queryKey: prefix }, …)` matches by key *prefix*,
 * so an updater written for the mailbox list also runs against every other
 * cached query sharing that prefix. Those do not all have the same shape: the
 * mailbox list is an infinite query (`{ pages: [{ items }] }`) while
 * single-shot readers of the same endpoint — the rescue-candidate search, for
 * one — cache a plain page (`{ items }`). An updater that assumed the infinite
 * shape threw `pages is undefined` inside `onMutate`, which React Query reports
 * as a failed mutation: the move never fired and the user got an error toast
 * for an action that was never attempted (issues #51, #55).
 *
 * `patchThreadListCache` handles both shapes and leaves anything else it does
 * not recognise untouched.
 */

export interface ThreadItemsPage {
	items: RemitImapThreadMessageResponse[];
	[key: string]: unknown;
}

export interface InfiniteThreadData {
	pages: ThreadItemsPage[];
	pageParams: Array<string | undefined>;
}

/** Either cached shape served by the thread list/search endpoints. */
export type ThreadListCache = InfiniteThreadData | ThreadItemsPage;

export const isInfiniteThreadData = (
	data: unknown,
): data is InfiniteThreadData =>
	typeof data === "object" &&
	data !== null &&
	Array.isArray((data as { pages?: unknown }).pages);

const isThreadItemsPage = (data: unknown): data is ThreadItemsPage =>
	typeof data === "object" &&
	data !== null &&
	Array.isArray((data as { items?: unknown }).items);

/**
 * Apply `patchItems` to every list of thread messages inside a cache entry,
 * whichever shape it holds.
 *
 * `old` is `unknown` because that is the truth: a prefix match hands this
 * whatever happens to be cached under that prefix, and the two shapes below are
 * the ones we know about today, not the ones we are guaranteed. Declaring a
 * narrower parameter type is what produced the original bug — the type asserted
 * a shape the runtime never promised, and the first entry that disagreed threw.
 * Anything unrecognised is returned untouched.
 */
export const patchThreadListCache = (
	old: unknown,
	patchItems: (
		items: RemitImapThreadMessageResponse[],
	) => RemitImapThreadMessageResponse[],
): unknown => {
	if (old === undefined) return old;
	if (isInfiniteThreadData(old)) {
		return {
			...old,
			pages: old.pages.map((page) => ({
				...page,
				items: patchItems(page.items),
			})),
		};
	}
	if (isThreadItemsPage(old)) {
		return { ...old, items: patchItems(old.items) };
	}
	return old;
};
