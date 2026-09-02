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
 * for a minute. The criteria carry the committed query, never the text being
 * typed, so nothing here is on a keystroke path.
 */
import { unifiedThreadOperationsListAllThreadsQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { unifiedThreadOperationsListAllThreads } from "@remit/api-http-client/sdk.gen.ts";
import type {
	RemitImapMessageCategory,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { ResultCount } from "@remit/ui";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { BriefSectionParams } from "@/lib/brief-criteria";
import { toResultCount } from "@/lib/result-count";

/** A minute: a brief reopened straight away costs nothing. */
const BRIEF_STALE_TIME_MS = 60_000;

/** No number at all, which is what a section shows when nobody counted it. */
const UNCOUNTED: ResultCount = { kind: "unknown" };

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

export interface BriefSectionRows {
	category: RemitImapMessageCategory;
	rows: RemitImapThreadMessageResponse[];
	total: ResultCount;
	loading: boolean;
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
	isLoading: boolean;
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
			return {
				queryKey: unifiedThreadOperationsListAllThreadsQueryKey({ query }),
				queryFn: async () => {
					const { data } = await unifiedThreadOperationsListAllThreads({
						query,
						throwOnError: true,
					});
					return data;
				},
				staleTime: BRIEF_STALE_TIME_MS,
			};
		}),
	});

	const countQueries = useQueries({
		queries: categories.map((category) => {
			const query = sectionCountQuery(criteria, category);
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
				staleTime: BRIEF_STALE_TIME_MS,
			};
		}),
	});

	const sections = useMemo<BriefSectionRows[]>(
		() =>
			categories.map((category, index) => ({
				category,
				rows: rowQueries[index]?.data?.items ?? [],
				// `enabled` gates the request, not the cache: a brief that asks for no
				// count must not render the one an earlier, narrower brief left behind.
				total: counted
					? toResultCount(countQueries[index]?.data?.count)
					: UNCOUNTED,
				loading: rowQueries[index]?.isLoading ?? true,
			})),
		[categories, rowQueries, countQueries, counted],
	);

	const refetch = useCallback(() => {
		for (const query of rowQueries) query.refetch();
		for (const query of countQueries) query.refetch();
	}, [rowQueries, countQueries]);

	return {
		sections,
		isLoading: rowQueries.some((query) => query.isLoading),
		isError: rowQueries.some((query) => query.isError),
		refetch,
	};
}
