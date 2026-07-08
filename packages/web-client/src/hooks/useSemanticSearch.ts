import { semanticSearchOperationsSemanticSearchOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapSemanticSearchResult } from "@remit/api-http-client/types.gen.ts";
import { MessageCategory } from "@remit/domain-enums";
import { useQuery } from "@tanstack/react-query";
import { useMailContext } from "@/lib/mail-context";
import { normalizeSearchQuery } from "@/lib/search-query";

/** Cap the "Related" section; the literal "Top matches" is the primary surface. */
const SEMANTIC_RESULT_LIMIT = 20;

const MESSAGE_CATEGORIES = new Set<string>(Object.values(MessageCategory));

/** Narrow a filter-chip id to a real category, or `undefined` for `"all"` / any unknown value. */
const toCategoryParam = (
	filterCategory: string | undefined,
): (typeof MessageCategory)[keyof typeof MessageCategory] | undefined =>
	filterCategory !== undefined && MESSAGE_CATEGORIES.has(filterCategory)
		? (filterCategory as (typeof MessageCategory)[keyof typeof MessageCategory])
		: undefined;

interface UseSemanticSearchParams {
	/**
	 * Restrict results to a single mailbox (the scoped inbox). Omit for the
	 * cross-account daily brief, where semantic search spans every account.
	 */
	mailboxId?: string;
	/**
	 * Restrict results to a single header-derived category. The sentinel `"all"`
	 * means no category scope — the param is omitted from the request entirely.
	 */
	filterCategory?: string;
}

/**
 * Fetch semantic-search hits for the active query (one source of truth: the
 * debounced `searchQuery` in `MailContext`). Scoping mirrors the literal search:
 * pass `mailboxId` for a scoped inbox, omit it for the global brief. Disabled
 * until the query is non-empty so an empty field issues no request.
 */
export function useSemanticSearch({
	mailboxId,
	filterCategory,
}: UseSemanticSearchParams = {}): {
	hits: RemitImapSemanticSearchResult[];
	isLoading: boolean;
} {
	const { searchQuery } = useMailContext();
	const query = normalizeSearchQuery(searchQuery);
	const enabled = query.length > 0;

	const category = toCategoryParam(filterCategory);

	const { data, isLoading } = useQuery({
		...semanticSearchOperationsSemanticSearchOptions({
			query: {
				query,
				mailboxId,
				limit: SEMANTIC_RESULT_LIMIT,
				...(category !== undefined ? { category } : {}),
			},
		}),
		enabled,
		staleTime: 60_000,
	});

	return { hits: data?.items ?? [], isLoading: enabled && isLoading };
}
