/**
 * The daily brief's rows: one `listAllThreads` request per section it shows,
 * scoped to that section's category, plus one count of the whole category.
 *
 * The brief used to be a single non-paginated page of the newest 50 unified
 * rows, and every section was "the Marketing rows among those 50" presented as
 * Marketing. On a mailbox whose Marketing mail is all older than that window the
 * section rendered empty above a header reading zero (#312). A category-scoped
 * request answers over the whole scope, so a section holds that category's
 * newest mail however far down the unified order it sits.
 *
 * The brief does not paginate as a whole; it paginates by section. Each section
 * takes its newest {@link SECTION_ROW_CAP} rows and states its real size, and
 * the way to the rest is the brief's own filtered list for that category — no
 * cursor here, and no request that walks a mailbox.
 *
 * The counts are the second read. One per displayed section, keyed on the
 * criteria alone so no page, cursor or expansion can trigger another, and held
 * for a minute. The criteria are the caller's committed state — the query as it
 * was submitted, and the chips as that query and the panel leave them — so
 * nothing here is on a keystroke path.
 *
 * Each section loads and fails on its own. Seven requests are seven answers, and
 * one category's failed request is not a reason to blank the six that came back:
 * a section carries its own pending and error state, and the brief renders what
 * it has. What reaches that state is a transport failure — a request that never
 * got an answer. A 5xx is the API breaking rather than this section failing, and
 * escalates globally on the fail-fast contract (`shouldEscalate`, #1059); there
 * is no `meta` opt-out here and there must not be one.
 *
 * A refetch under the same predicate keeps the rows already on screen. Under a
 * different one it does not — the previous chip's mail under the new chip is the
 * defect `sameInboxFilter` exists to stop — so only a change of free text holds
 * the previous answer while the next one is in flight.
 *
 * Sections are the unsearched brief only. Under a query the brief is one list in
 * one order — see `useBriefSearchRows`.
 */
import { unifiedThreadOperationsListAllThreadsQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { unifiedThreadOperationsListAllThreads } from "@remit/api-http-client/sdk.gen.ts";
import type {
	RemitImapMessageCategory,
	RemitImapThreadMessageResponse,
	RemitImapThreadSearchResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { ResultCount } from "@remit/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { BriefSectionParams } from "@/lib/brief-criteria";
import { type InboxFilterParams, sameInboxFilter } from "@/lib/inbox-filters";
import { toResultCount } from "@/lib/result-count";

/** A minute: a brief reopened straight away costs nothing. */
const BRIEF_STALE_TIME_MS = 60_000;

/** Half a minute: a query being refined re-asks sooner than the brief does. */
const SEARCH_STALE_TIME_MS = 30_000;

/** No number at all, which is what a section shows when nobody counted it. */
const UNCOUNTED: ResultCount = { kind: "unknown" };

/**
 * Hold the previous answer while the next one is in flight, but only where the
 * predicate is unchanged. A chip that changes what is being asked for takes its
 * rows with it: the previous chip's mail under the new chip, for one round trip,
 * is what `sameInboxFilter` was written to stop (design D18).
 */
const keepUnderSameFilter =
	(filter: InboxFilterParams) =>
	(
		previous: RemitImapThreadSearchResponse | undefined,
		previousQuery: { queryKey: readonly unknown[] } | undefined,
	): RemitImapThreadSearchResponse | undefined =>
		sameInboxFilter(previousQuery?.queryKey, filter) ? previous : undefined;

/** The criteria every section request carries, its own category aside. */
export interface BriefSectionsCriteria extends BriefSectionParams {
	/** Committed free text, matched against subject and From across folders. */
	query?: string;
}

const sectionRowsQuery = (
	criteria: BriefSectionsCriteria,
	category: RemitImapMessageCategory,
	limit: number,
) => ({
	...criteria,
	category: [category],
	limit,
	order: "desc" as const,
});

// No `limit` and no cursor: the count is a property of the criteria, so growing
// the page cannot change it and cannot ask for it again.
const sectionCountQuery = (
	criteria: BriefSectionsCriteria,
	category: RemitImapMessageCategory,
) => ({
	...criteria,
	category: [category],
	order: "desc" as const,
	count: true,
	results: false,
});

/**
 * What a request under these criteria asks for, as `sameInboxFilter` reads it.
 * Free text is deliberately not part of it: a query being refined is the one
 * change that may keep the previous answer on screen.
 */
const sectionFilter = (
	criteria: BriefSectionsCriteria,
	category: RemitImapMessageCategory,
): InboxFilterParams => ({
	category: [category],
	...(criteria.unread !== undefined ? { unread: criteria.unread } : {}),
	...(criteria.starred !== undefined ? { starred: criteria.starred } : {}),
	...(criteria.attachments !== undefined
		? { attachments: criteria.attachments }
		: {}),
});

export interface BriefSectionRows {
	category: RemitImapMessageCategory;
	rows: RemitImapThreadMessageResponse[];
	total: ResultCount;
	/** The request came back full, so the category holds more than these rows. */
	atCap: boolean;
	/** Nothing has arrived for this section yet. */
	loading: boolean;
	/** This section's own request failed; the others are unaffected. */
	failed: boolean;
	/** Ask this one section again. */
	retry: () => void;
}

export interface UseBriefSectionsOptions {
	/** The categories the brief is showing, in display order. */
	categories: readonly RemitImapMessageCategory[];
	criteria: BriefSectionsCriteria;
	/** Rows per section. */
	limit: number;
	/**
	 * Whether the request saw every criterion on screen. False, no count is asked
	 * for and every section reports no number — see `briefCountsMatchRows`.
	 */
	counted: boolean;
}

export interface UseBriefSections {
	sections: BriefSectionRows[];
	/** Nothing has arrived for any section — the brief has nothing to render. */
	isLoading: boolean;
	/** Every section failed. One failing section is the section's own state. */
	isError: boolean;
	refetch: () => void;
}

export function useBriefSections({
	categories,
	criteria,
	limit,
	counted,
}: UseBriefSectionsOptions): UseBriefSections {
	const rowQueries = useQueries({
		queries: categories.map((category) => {
			const query = sectionRowsQuery(criteria, category, limit);
			const filter = sectionFilter(criteria, category);
			return {
				queryKey: unifiedThreadOperationsListAllThreadsQueryKey({ query }),
				queryFn: async () => {
					const { data } = await unifiedThreadOperationsListAllThreads({
						query,
						throwOnError: true,
					});
					return data;
				},
				placeholderData: keepUnderSameFilter(filter),
				staleTime: BRIEF_STALE_TIME_MS,
			};
		}),
	});

	const countQueries = useQueries({
		queries: categories.map((category) => {
			const query = sectionCountQuery(criteria, category);
			const filter = sectionFilter(criteria, category);
			return {
				queryKey: unifiedThreadOperationsListAllThreadsQueryKey({ query }),
				queryFn: async () => {
					const { data } = await unifiedThreadOperationsListAllThreads({
						query,
						throwOnError: true,
					});
					return data;
				},
				enabled: counted,
				placeholderData: keepUnderSameFilter(filter),
				staleTime: BRIEF_STALE_TIME_MS,
			};
		}),
	});

	const sections = useMemo<BriefSectionRows[]>(
		() =>
			categories.map((category, index) => {
				const rows = rowQueries[index];
				const count = countQueries[index];
				const items = rows?.data?.items ?? [];
				return {
					category,
					rows: items,
					// Read off the page rather than the rendered rows: muting and the
					// thread collapse both shrink what is rendered, and neither means the
					// category holds no more.
					atCap: items.length >= limit,
					// `enabled` gates the request, not the cache: a brief that asks for
					// no count must not render the one an earlier, narrower brief left
					// behind.
					total: counted ? toResultCount(count?.data?.count) : UNCOUNTED,
					// Pending, not fetching: a section holding the previous query's rows
					// has something to render, and replacing it with a skeleton takes the
					// brief off screen every time the search field is cleared.
					loading: rows?.isPending ?? true,
					failed: rows?.isError ?? false,
					retry: () => {
						rows?.refetch();
						// `refetch` ignores `enabled`, so an uncounted brief would fetch a
						// count it has already decided not to render.
						if (counted) count?.refetch();
					},
				};
			}),
		[categories, rowQueries, countQueries, counted, limit],
	);

	const refetch = useCallback(() => {
		for (const query of rowQueries) query.refetch();
		for (const query of countQueries) query.refetch();
	}, [rowQueries, countQueries]);

	return {
		sections,
		// The whole-body states are the ones where there is genuinely nothing to
		// show. A section that is still loading, or that failed on its own, says so
		// in its own place while the rest of the brief stands.
		isLoading:
			rowQueries.length > 0 && rowQueries.every((query) => query.isPending),
		isError:
			rowQueries.length > 0 && rowQueries.every((query) => query.isError),
		refetch,
	};
}

/** What a searched brief holds before the reader is told to narrow it. */
export interface BriefSearchCriteria extends BriefSectionsCriteria {
	/** A category the chips or a `category:` term narrowed the search to. */
	category?: RemitImapMessageCategory[];
}

export interface UseBriefSearchRows {
	/** Every match the request returned, in the order the server returned them. */
	rows: RemitImapThreadMessageResponse[];
	isLoading: boolean;
	isError: boolean;
	refetch: () => void;
}

/**
 * The brief under a search: one request, one globally newest-first list.
 *
 * Not seven category queries stitched back together. A match's category must not
 * lift it above a newer match, and section headers between the rows would do
 * exactly that — an old newsletter above a mail that arrived this morning. The
 * server orders the whole match set; the client renders it in that order (#312).
 *
 * Search mode also widens the scope past INBOX to every non-muted folder of every
 * account, so this is the only request that reaches Archive, Sent and Spam.
 */
export function useBriefSearchRows(
	criteria: BriefSearchCriteria,
	limit: number,
	enabled: boolean,
): UseBriefSearchRows {
	const query = { ...criteria, limit, order: "desc" as const };
	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: unifiedThreadOperationsListAllThreadsQueryKey({ query }),
		queryFn: async () => {
			const { data: page } = await unifiedThreadOperationsListAllThreads({
				query,
				throwOnError: true,
			});
			return page;
		},
		enabled,
		staleTime: SEARCH_STALE_TIME_MS,
	});
	const rows = useMemo(
		() => (enabled ? (data?.items ?? []) : []),
		[data, enabled],
	);
	return {
		rows,
		isLoading: enabled && isLoading,
		isError: enabled && isError,
		refetch: useCallback(() => {
			refetch();
		}, [refetch]),
	};
}
