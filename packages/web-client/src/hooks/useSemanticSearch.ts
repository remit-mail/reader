import { semanticSearchOperationsSemanticSearchOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapSemanticSearchResult } from "@remit/api-http-client/types.gen.ts";
import { MessageCategory } from "@remit/domain-enums";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useMailContext } from "@/lib/mail-context";
import { normalizeSearchQuery } from "@/lib/search-query";
import { semanticMailboxScope } from "@/lib/search-scope";
import { parseSearchTokens } from "@/lib/search-tokens";
import { useSearchTokenContext } from "./useSearchTokenContext";

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
	 * Restrict results to a single mailbox. A mailbox route pins the scope to its
	 * own mailbox regardless of what is passed here, so this only carries a scope
	 * a route does not already imply.
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
 * debounced `searchQuery` in `MailContext`). Scoping mirrors the literal search
 * and is taken from the route (`semanticMailboxScope`): no chip means global, a
 * chip means this engine respects it like every other. Disabled until the query
 * is non-empty so an empty field issues no request.
 *
 * Filter tokens (`has:attachment`, `is:unread`, `before:`/`after:`) parsed from
 * the query map onto the search API's own filter params. `from:` and
 * `account:` have no equivalent on `GET /search/semantic` (no sender or
 * account filter) — both still render as chips and narrow the literal engine,
 * but never reach the semantic request (`account:` is a documented gap, see
 * doc/design/flows/06-search.md — the semantic index is per account config).
 * `in:` resolves to a mailboxId, so typing `in:archive` re-scopes the search
 * from the unscoped daily brief. It cannot contradict a scoped view because
 * `useSearchTokenContext` does not resolve the term there at all — the term
 * stays free text and no engine, and no chip, treats it as a filter.
 *
 * With no resolved mailbox the request spans every mailbox of every account the
 * caller owns: the backend partitions the vector index by accountConfigId (one
 * per signed-in user, not per mail account), so unscoped is genuinely global.
 */
export function useSemanticSearch({
	mailboxId,
	filterCategory,
}: UseSemanticSearchParams = {}): {
	hits: RemitImapSemanticSearchResult[];
	isLoading: boolean;
} {
	const { searchQuery } = useMailContext();
	const tokenContext = useSearchTokenContext();
	const matches = useRouterState({ select: (s) => s.matches });
	const normalizedQuery = normalizeSearchQuery(searchQuery);
	const { freeText, tokens } = parseSearchTokens(normalizedQuery, tokenContext);
	// `freeText`, not the raw query: a query of nothing but tokens
	// (`has:attachment`, `in:archive`) parses to empty free text, and asking a
	// vector index what an empty string means has no answer to give. The literal
	// engines still apply those tokens; the semantic section simply has nothing
	// to rank.
	const enabled = freeText.length > 0;

	const category = toCategoryParam(filterCategory);
	const hasAttachment = tokens.some((t) => t.type === "hasAttachment")
		? true
		: undefined;
	const isRead = tokens.some((t) => t.type === "isUnread") ? false : undefined;
	const afterToken = tokens.find((t) => t.type === "after");
	const beforeToken = tokens.find((t) => t.type === "before");
	const inToken = tokens.find((t) => t.type === "in");
	// The route decides the scope, not the call site — see `semanticMailboxScope`.
	const effectiveMailboxId = semanticMailboxScope({
		matches,
		callerMailboxId: mailboxId,
		inTokenMailboxId: inToken?.mailboxId,
	});

	const { data, isLoading } = useQuery({
		...semanticSearchOperationsSemanticSearchOptions({
			query: {
				query: freeText,
				mailboxId: effectiveMailboxId,
				limit: SEMANTIC_RESULT_LIMIT,
				...(category !== undefined ? { category } : {}),
				...(hasAttachment !== undefined ? { hasAttachment } : {}),
				...(isRead !== undefined ? { isRead } : {}),
				...(afterToken ? { sentDateFrom: afterToken.epochSeconds } : {}),
				...(beforeToken ? { sentDateTo: beforeToken.epochSeconds } : {}),
			},
		}),
		enabled,
		staleTime: 60_000,
	});

	return { hits: data?.items ?? [], isLoading: enabled && isLoading };
}
