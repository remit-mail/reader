import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
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
 * It also writes only while the reader is still on this list. A list stays
 * mounted, effects and all, until the list they navigated to is ready to paint,
 * and by then the address is already the new one — so a debounce settling in
 * that window would fire a navigation to *this* list, superseding the load in
 * flight and replacing the entry the reader had just pushed. They would click
 * Inbox and land back on the brief.
 *
 * When a query *goes* active it also closes the reading pane (#539): an open
 * message from the pre-search list is not meaningful in the search result set.
 * The close is a navigation to the list route, which unmatches the thread that
 * was open under it. Any other write keeps the address it found: mirroring a
 * query the reader is editing, or clearing one, must not shut the conversation
 * they are reading.
 *
 * Only on that transition, though — tapping a search result commits the same `q`
 * with the open thread, so when the URL already says the query the conversation
 * was opened under it (not a pre-search leftover) and must survive. The close
 * otherwise raced the tap: the row shows before the debounce settles, so this
 * mirror can land just after the open and undo it.
 */
export function useSearchMirror(target: SearchMirrorTarget): void {
	const navigate = useNavigate();
	const { searchInput, searchQuery: committedQuery } = useMailContext();
	const { q: urlQuery = "" } = useSearch({ from: "/mail" });
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	// Read at effect time rather than depended on: the URL is what the mirror
	// compares against, not what re-triggers it.
	const urlQueryRef = useRef(urlQuery);
	urlQueryRef.current = urlQuery;

	const { to } = target;
	const mailboxId = "params" in target ? target.params.mailboxId : undefined;
	const listPath = mailboxId ? `/mail/${mailboxId}` : to;

	useEffect(() => {
		const mayWrite = shouldMirrorQuery({
			searchInput,
			committedQuery,
			urlQuery: urlQueryRef.current,
			pathname,
			listPath,
		});
		if (!mayWrite) return;
		const queryGoesActive =
			Boolean(committedQuery) && urlQueryRef.current !== committedQuery;
		const search = (prev: Record<string, unknown>) => ({
			...prev,
			q: committedQuery || undefined,
		});
		// `hash: true`: a query is a mode of the view the reader is already in, so
		// the panel they have up is not something they navigated away from.
		if (!queryGoesActive) {
			navigate({ to: ".", search, hash: true, replace: true });
			return;
		}
		if (to === "/mail/$mailboxId") {
			if (!mailboxId) return;
			navigate({
				to,
				params: { mailboxId },
				search,
				hash: true,
				replace: true,
			});
			return;
		}
		navigate({ to, search, hash: true, replace: true });
	}, [
		searchInput,
		committedQuery,
		navigate,
		to,
		mailboxId,
		listPath,
		pathname,
	]);
}
