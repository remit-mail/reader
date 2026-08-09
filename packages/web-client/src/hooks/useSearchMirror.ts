import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useMailContext } from "@/lib/mail-context";
import { shouldMirrorQuery } from "@/lib/search-view";

/**
 * The list the mirror writes to. Each list calls the hook with its own route,
 * so the query lands on the list rather than on whatever is open below it.
 */
export type SearchMirrorTarget =
	| { to: "/mail/brief" | "/mail/flagged" | "/mail/outbox" }
	| { to: "/mail/$mailboxId"; params: { mailboxId: string } };

/**
 * Mirrors the settled search into the URL so links are shareable and a refresh
 * restores the query.
 *
 * Within a view this is one-directional — the URL is not read back into state,
 * so there is no sync loop — and it writes only once the debounce agrees with
 * the field, so a query arriving by URL is never overwritten mid-debounce, and
 * the query the user just left behind is never written onto the view they landed
 * on (`shouldMirrorQuery`).
 *
 * When a query *goes* active it also strips the selection so the reading pane
 * closes (#539): an open message from the pre-search list is not meaningful in
 * the search result set. Only on that transition though — tapping a search
 * result commits the same `q` with the selection, so when `prev.q` already
 * equals the query the result was opened under it (not a pre-search leftover)
 * and must survive. The strip otherwise raced the tap: the row shows before the
 * debounce settles, so this mirror can land just after the open and close it
 * again.
 */
export function useSearchMirror(target: SearchMirrorTarget): void {
	const navigate = useNavigate();
	const { searchInput, searchQuery: committedQuery } = useMailContext();
	const { q: urlQuery = "" } = useSearch({ from: "/mail" });

	// Read at effect time rather than depended on: the URL is what the mirror
	// compares against, not what re-triggers it.
	const urlQueryRef = useRef(urlQuery);
	urlQueryRef.current = urlQuery;

	const { to } = target;
	const mailboxId = "params" in target ? target.params.mailboxId : undefined;

	useEffect(() => {
		if (!shouldMirrorQuery(searchInput, committedQuery, urlQueryRef.current))
			return;
		const search = (prev: Record<string, unknown>) => {
			const queryAlreadyActive = prev.q === committedQuery;
			return {
				...prev,
				q: committedQuery || undefined,
				...(committedQuery && !queryAlreadyActive
					? {
							selectedMessageId: undefined,
							selectedThreadId: undefined,
							selectedMailboxId: undefined,
						}
					: {}),
			};
		};
		if (to === "/mail/$mailboxId") {
			if (!mailboxId) return;
			navigate({ to, params: { mailboxId }, search, replace: true });
			return;
		}
		navigate({ to, search, replace: true });
	}, [searchInput, committedQuery, navigate, to, mailboxId]);
}
