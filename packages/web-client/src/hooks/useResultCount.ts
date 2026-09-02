import { threadOperationsSearchThreadsQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { threadOperationsSearchThreads } from "@remit/api-http-client/sdk.gen.ts";
import type { ThreadOperationsSearchThreadsData } from "@remit/api-http-client/types.gen.ts";
import type { ResultCount } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { toResultCount } from "@/lib/result-count";

/**
 * What the list is asking about, with nothing about paging in it. The count is
 * a property of the criteria alone, so a page fetch can never trigger one.
 */
export type ThreadSearchCriteria = Omit<
	NonNullable<ThreadOperationsSearchThreadsData["query"]>,
	"continuationToken" | "limit" | "count" | "results"
>;

export interface UseResultCountOptions {
	mailboxId: string;
	criteria: ThreadSearchCriteria;
	/**
	 * Whether this search is worth counting at all — see
	 * `shouldRequestResultCount`. Disabled, the surface renders no number rather
	 * than a stale one from the search before it.
	 */
	enabled: boolean;
}

/** A minute: long enough that returning to a search just left costs nothing. */
const COUNT_STALE_TIME_MS = 60_000;

/**
 * How many messages the search matches, from the server that resolves it —
 * one request against the criteria, never a walk of the pages (#307).
 *
 * Its own query, keyed on the criteria without the cursor, so the list pages
 * without re-counting. An answer that carries no count — off-row criteria, per
 * #305 — stays absent rather than becoming a zero.
 */
export const useResultCount = ({
	mailboxId,
	criteria,
	enabled,
}: UseResultCountOptions): ResultCount => {
	const query = { ...criteria, count: true, results: false };
	const { data } = useQuery({
		queryKey: threadOperationsSearchThreadsQueryKey({
			path: { mailboxId },
			query,
		}),
		queryFn: async () => {
			const { data: response } = await threadOperationsSearchThreads({
				path: { mailboxId },
				query,
				throwOnError: true,
			});
			return response;
		},
		enabled,
		staleTime: COUNT_STALE_TIME_MS,
	});
	// `enabled` gates the request, not the cache: a criteria set that asks for no
	// count still reads whatever the last identical key left behind. Two searches
	// share a key whenever the terms that separate them reach the request as
	// nothing — `before:`/`after:`/`account:` are stripped from the free text and
	// carry no param — so a disabled count that read `data` would render the
	// previous search's total over this one's rows.
	return enabled ? toResultCount(data?.count) : { kind: "unknown" };
};
