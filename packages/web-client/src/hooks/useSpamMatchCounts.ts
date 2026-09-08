/**
 * How much of a search sits in Spam: one `listAllThreads` count per junk folder
 * the search reached, under the search's own criteria.
 *
 * One request per folder rather than one for all of them, because the scope
 * parameter names a single mailbox — and because the offer needs the folders
 * apart as well as together: the sum is what it states, the largest is where its
 * button goes. Accounts have one junk folder each, so this is one request per
 * account and it is issued when the committed criteria change, never on a
 * keystroke.
 *
 * `accountId` rides along on the criteria whenever the account pill is set, and
 * the server intersects the two scopes: a junk folder of another account counts
 * nothing. That is what keeps the sum the size of the list the reader is looking
 * at rather than of every account they have.
 *
 * A count that has not arrived, failed, or came back absent is `unknown` for
 * that folder, and `spamOfferFromCounts` turns any one of those into an unknown
 * total. Nothing here substitutes a page length for a count the server did not
 * give (#313).
 */
import { unifiedThreadOperationsListAllThreadsQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { unifiedThreadOperationsListAllThreads } from "@remit/api-http-client/sdk.gen.ts";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { BriefSearchCriteria } from "@/hooks/useBriefSections";
import { toResultCount } from "@/lib/result-count";
import type { SpamMailboxCount } from "@/lib/spam-offer";

/** Half a minute, matching the searched brief's own rows. */
const SPAM_COUNT_STALE_TIME_MS = 30_000;

const UNCOUNTED: SpamMailboxCount["count"] = { kind: "unknown" };

export interface UseSpamMatchCountsOptions {
	/** The committed search, exactly as the rows beneath the offer were asked for. */
	criteria: BriefSearchCriteria;
	/** Every junk folder in the search's scope, in a stable order. */
	junkMailboxIds: readonly string[];
	/**
	 * Whether a count is worth asking for. False while the view carries a term
	 * the request cannot express — the server would count a wider set than the
	 * list shows — and every folder reports no number.
	 */
	enabled: boolean;
}

// No `limit` and no cursor: the count is a property of the criteria, so no page
// of mail is paid for and no expansion can ask for it again.
const spamCountQuery = (criteria: BriefSearchCriteria, mailboxId: string) => ({
	...criteria,
	mailboxId,
	order: "desc" as const,
	count: true,
	results: false,
});

export function useSpamMatchCounts({
	criteria,
	junkMailboxIds,
	enabled,
}: UseSpamMatchCountsOptions): SpamMailboxCount[] {
	const countQueries = useQueries({
		queries: junkMailboxIds.map((mailboxId) => {
			const query = spamCountQuery(criteria, mailboxId);
			return {
				queryKey: unifiedThreadOperationsListAllThreadsQueryKey({ query }),
				queryFn: async () => {
					const { data } = await unifiedThreadOperationsListAllThreads({
						query,
						throwOnError: true,
					});
					return data;
				},
				enabled,
				staleTime: SPAM_COUNT_STALE_TIME_MS,
			};
		}),
	});

	return useMemo(
		() =>
			junkMailboxIds.map((mailboxId, index) => ({
				mailboxId,
				// `enabled` gates the request, not the cache: an uncounted view must
				// not state the number an earlier, differently-scoped one left behind.
				count: enabled
					? toResultCount(countQueries[index]?.data?.count)
					: UNCOUNTED,
			})),
		[junkMailboxIds, countQueries, enabled],
	);
}
