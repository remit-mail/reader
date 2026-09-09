import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMailContext } from "@/lib/mail-context";
import { addressQuery } from "@/lib/mail-route";
import { shouldMirrorQuery } from "@/lib/search-view";
import { useIsComposing } from "./compose";
import { useIsReplying } from "./reply";

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
 * It watches the URL as well as the field, so a settled query that the address
 * stops agreeing with is written again rather than left (#808). Typing lands
 * more than one navigation — the debounce settles mid-word, and the word is
 * finished while that write is still in flight — and the two can commit out of
 * order, leaving the address on the prefix. Comparing against the URL without
 * re-running on it made that final: the field said `invoice`, the address said
 * `invo`, and nothing was left to disagree with. Re-running cannot start a
 * loop, because every write makes the URL equal the committed query and the
 * next run has nothing to do. The `q` it compares against is the committed
 * address's, the same place the pathname below comes from: the matched route
 * answers with the outgoing list's query for a render after the address has
 * moved on, and a mirror reading one from each would write against a URL that
 * no longer exists.
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
 *
 * A composer is not the pre-search list's leftover either. It is the reader's
 * own unsent message, so a search started while it is up narrows the list
 * behind it and leaves it standing. A reply, a reply-all and a forward hold
 * unsent text the same way and are spared the same way. Both are read off the
 * path, so neither has to be kept in step with the surface that is showing.
 */
export function useSearchMirror(target: SearchMirrorTarget): void {
	const navigate = useNavigate();
	const { searchInput, searchQuery: committedQuery } = useMailContext();
	const urlQuery = useRouterState({
		select: (s) => addressQuery(s.location.search),
	});
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const isComposing = useIsComposing();
	const isReplying = useIsReplying();
	const isWriting = isComposing || isReplying;

	const { to } = target;
	const mailboxId = "params" in target ? target.params.mailboxId : undefined;
	const listPath = mailboxId ? `/mail/${mailboxId}` : to;

	useEffect(() => {
		const mayWrite = shouldMirrorQuery({
			searchInput,
			committedQuery,
			urlQuery,
			pathname,
			listPath,
		});
		if (!mayWrite) return;
		const queryGoesActive =
			Boolean(committedQuery) && urlQuery !== committedQuery;
		// A message being written is the reader's own, not a leftover of the list
		// they were on, so a query going active narrows the list behind it and
		// leaves it where it is.
		const closesTheOpenSurface = queryGoesActive && !isWriting;
		const search = (prev: Record<string, unknown>) => ({
			...prev,
			q: committedQuery || undefined,
		});
		// A query is a mode of the view the reader is already in, so the panels
		// they have up are not ones they navigated away from.
		if (!closesTheOpenSurface) {
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
		urlQuery,
		navigate,
		to,
		mailboxId,
		listPath,
		pathname,
		isWriting,
	]);
}
