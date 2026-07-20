import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";
import { useMailContext } from "@/lib/mail-context";
import {
	SEARCH_SCOPE_CHIP_ID,
	type SearchScopeState,
	searchScopeForRoute,
} from "@/lib/search-scope";
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
	scope: SearchScopeState;
	clearScope: (chipId: string) => void;
} {
	const navigate = useNavigate();
	const { searchInput } = useMailContext();
	const mailboxName = useCurrentMailboxName({ accounts });
	// Select the matches, not the scope: a select closing over `mailboxName`
	// only re-runs on router state changes, so the chip would keep reading the
	// previous folder until the next navigation.
	const matches = useRouterState({ select: (s) => s.matches });
	const scope = searchScopeForRoute(matches, mailboxName);

	// Takes the chip id the field removed rather than assuming which chip that
	// was. The bar owns one chip today; keying on the id means a second one
	// added later cannot silently drop the user out of their scope.
	const clearScope = useCallback(
		(chipId: string) => {
			if (chipId !== SEARCH_SCOPE_CHIP_ID) return;
			navigate({
				to: "/mail",
				search: { q: searchInput || undefined, selectedMessageId: undefined },
			});
		},
		[navigate, searchInput],
	);

	return { scope, clearScope };
}
