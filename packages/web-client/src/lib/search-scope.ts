/**
 * The search scope is the route.
 *
 * Search is the app's search: one field in the top bar, and by default it
 * covers everything. Navigating the sidebar narrows it, and the narrowing is
 * shown as one chip in the field — `in:spam` while viewing Spam. The chip is
 * derived from the active route, not parsed out of the typed text: the route
 * decides which pane is mounted and which mail that pane reads, and the chip is
 * that decision made visible. Navigating elsewhere replaces the chip because the
 * route changed.
 *
 * Removing the chip means "search everything", which is the daily brief — the
 * cross-account view whose scope is nothing. So removal is a navigation to
 * `/mail/` carrying the query, not an edit of the query text.
 *
 * There is exactly one scope, and it is this one. A typed `in:` term is a
 * second, competing answer to "which mailbox", so it is recognized only where
 * there is no route scope to compete with — see `isScopedRoute` and
 * `useSearchTokenContext`. Every engine parses the query through that one
 * context, so a scoped view cannot show a chip for a term it is ignoring.
 *
 * Pure functions only. `useSearchScope` binds these to the router.
 */
import {
	isBriefRoute,
	isFlaggedRoute,
	isMailboxRoute,
	isOutboxRoute,
	type MailRouteMatch,
} from "./mail-route";

/**
 * Chip id of the scope chip. The top bar owns exactly one, so a fixed id is
 * enough of a removal handle.
 */
export const SEARCH_SCOPE_CHIP_ID = "search-scope";

export interface SearchScope {
	id: string;
	/** What the chip reads, e.g. `in:spam`. */
	label: string;
}

/**
 * What the field can say about its own scope.
 *
 * `pending` is the mailbox route before its name has loaded: the list under the
 * bar is already one mailbox, so the field must not claim to search everything,
 * but there is no name yet to put in a chip. It is a real third state, not a
 * flavour of `global`.
 */
export type SearchScopeState =
	| { kind: "global" }
	| { kind: "pending" }
	| { kind: "scoped"; chip: SearchScope };

/**
 * Render a mailbox name as an `in:` term. Lower-cased so it reads like the
 * operator it mimics, and quoted when the name has whitespace so the chip
 * stays one legible term.
 */
export function scopeLabelForMailboxName(name: string): string {
	const collapsed = name.trim().replace(/\s+/g, " ").toLowerCase();
	return /\s/.test(collapsed) ? `in:"${collapsed}"` : `in:${collapsed}`;
}

/**
 * True on the routes whose pane reads one mailbox or one virtual collection.
 * These carry a scope; the daily brief (and any route not recognized here) does
 * not.
 */
export function isScopedRoute(matches: readonly MailRouteMatch[]): boolean {
	return (
		isFlaggedRoute(matches) || isOutboxRoute(matches) || isMailboxRoute(matches)
	);
}

/**
 * The scope of the active route.
 *
 * `mailboxName` is the sidebar's own label for the mailbox route (resolved by
 * `useCurrentMailboxName`). Until it resolves the scope is `pending`: no chip,
 * because a chip reading a raw uuid is worse than none, but not `global`
 * either, because the list underneath is already narrowed.
 */
export function searchScopeForRoute(
	matches: readonly MailRouteMatch[],
	mailboxName?: string | null,
): SearchScopeState {
	if (isBriefRoute(matches)) return { kind: "global" };
	if (isFlaggedRoute(matches)) {
		return {
			kind: "scoped",
			chip: { id: SEARCH_SCOPE_CHIP_ID, label: "is:starred" },
		};
	}
	if (isOutboxRoute(matches)) {
		return {
			kind: "scoped",
			chip: { id: SEARCH_SCOPE_CHIP_ID, label: "in:outbox" },
		};
	}
	if (isMailboxRoute(matches)) {
		if (!mailboxName) return { kind: "pending" };
		return {
			kind: "scoped",
			chip: {
				id: SEARCH_SCOPE_CHIP_ID,
				label: scopeLabelForMailboxName(mailboxName),
			},
		};
	}
	return { kind: "global" };
}
