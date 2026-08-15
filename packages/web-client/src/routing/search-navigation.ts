import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Search everything, carrying the query.
 *
 * "Everything" is the daily brief — the cross-account view whose scope is
 * nothing — so dropping the scope chip and running a saved search are the same
 * movement, and both are a navigation rather than an edit of the query text:
 * the chip mirrors the route (see `lib/search-scope.ts`), so editing the text
 * would leave the chip up and the list still narrowed.
 */
export function useSearchEverything(): (query: string) => void {
	const navigate = useNavigate();
	return useCallback(
		(query: string) => {
			navigate({ to: "/mail/brief", search: { q: query || undefined } });
		},
		[navigate],
	);
}

/**
 * Narrow the search to one mailbox, carrying the query.
 *
 * The route is the scope, so the offer to look in Spam for what a global search
 * held back goes to Spam rather than rewriting the query with an `in:` term.
 */
export function useScopeSearchToMailbox(): (
	mailboxId: string,
	query: string,
) => void {
	const navigate = useNavigate();
	return useCallback(
		(mailboxId: string, query: string) => {
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: { q: query || undefined },
			});
		},
		[navigate],
	);
}
