import { useRouterState } from "@tanstack/react-router";
import { useMailContext } from "@/lib/mail-context";
import { isScopedRoute } from "@/lib/search-scope";
import type { SearchTokenContext } from "@/lib/search-tokens";

/**
 * The one context every search engine parses the query through.
 *
 * `in:` is recognized only where the route carries no scope. On a scoped view
 * the top bar's chip already answers "which mailbox", and a typed `in:` is a
 * second, competing answer that no engine there acts on — the literal search is
 * pinned to the route's mailbox and the semantic request takes the caller's
 * scope. Leaving the term unresolved means it stays ordinary words: it is
 * matched as text and never chipped, so the field can't advertise a filter that
 * does nothing. To search another folder, drop the scope chip or go to it.
 *
 * Every call site takes this hook rather than building its own context, because
 * the guarantee is that they agree. Two of them disagreeing is what made the
 * same query behave one way on `/mail/flagged` and another on a mailbox.
 */
export function useSearchTokenContext(): SearchTokenContext {
	const { mailboxNameIndex, accountNameIndex } = useMailContext();
	const scoped = useRouterState({ select: (s) => isScopedRoute(s.matches) });
	return {
		...(scoped ? {} : { mailboxesByName: mailboxNameIndex }),
		accountsByName: accountNameIndex,
	};
}
