import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useCallback } from "react";
import { useMailContext } from "@/lib/mail-context";
import {
	SEARCH_SCOPE_CHIP_ID,
	type SearchScopeState,
	searchScopeForRoute,
} from "@/lib/search-scope";
import { useBrowsedList, useSearchEverything } from "@/routing";
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
	const searchEverything = useSearchEverything();
	const { searchInput } = useMailContext();
	const mailboxName = useCurrentMailboxName({ accounts });
	const browsed = useBrowsedList();
	const scope = searchScopeForRoute(browsed, mailboxName);

	// Takes the chip id the field removed rather than assuming which chip that
	// was. The bar owns one chip today; keying on the id means a second one
	// added later cannot silently drop the user out of their scope.
	const clearScope = useCallback(
		(chipId: string) => {
			if (chipId !== SEARCH_SCOPE_CHIP_ID) return;
			searchEverything(searchInput);
		},
		[searchEverything, searchInput],
	);

	return { scope, clearScope };
}
