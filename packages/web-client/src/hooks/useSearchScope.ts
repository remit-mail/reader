import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";
import { useMailContext } from "@/lib/mail-context";
import { type SearchScope, searchScopeForRoute } from "@/lib/search-scope";
import { useCurrentMailboxName } from "./useCurrentMailboxName";

/**
 * The scope chip for the active route and the way off it.
 *
 * `clearScope` navigates to the daily brief carrying the current query, which
 * is what "search everything" means here — the brief is the unscoped
 * cross-account view. It is a navigation rather than a query edit because the
 * chip mirrors the route (see `lib/search-scope.ts`); editing the text would
 * leave the chip in place and the list still narrowed.
 */
export function useSearchScope(accounts: RemitImapAccountResponse[]): {
	scope: SearchScope | undefined;
	clearScope: () => void;
} {
	const navigate = useNavigate();
	const { searchInput } = useMailContext();
	const mailboxName = useCurrentMailboxName({ accounts });
	// Select the matches, not the scope: a select closing over `mailboxName`
	// only re-runs on router state changes, so the chip would keep reading the
	// previous folder until the next navigation.
	const matches = useRouterState({ select: (s) => s.matches });
	const scope = searchScopeForRoute(matches, mailboxName);

	const clearScope = useCallback(() => {
		navigate({
			to: "/mail",
			search: { q: searchInput || undefined, selectedMessageId: undefined },
		});
	}, [navigate, searchInput]);

	return { scope, clearScope };
}
