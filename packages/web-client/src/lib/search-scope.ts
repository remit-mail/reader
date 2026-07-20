/**
 * The search scope is the route.
 *
 * Search is the app's search: one field in the top bar, and by default it
 * covers everything. Navigating the sidebar narrows it, and the narrowing is
 * shown as one chip in the field — `in:spam` while viewing Spam. The chip is
 * derived from the active route, not parsed out of the typed text, so it
 * cannot disagree with the list underneath it: the route decides which pane is
 * mounted and which mail that pane reads, and the chip is that decision made
 * visible. Navigating elsewhere replaces the chip because the route changed.
 *
 * Removing the chip means "search everything", which is the daily brief — the
 * cross-account view whose scope is nothing. So removal is a navigation to
 * `/mail/` carrying the query, not an edit of the query text.
 *
 * Pure functions only. `useSearchScope` binds these to the router.
 */
import {
	isBriefRoute,
	isFlaggedRoute,
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
 * Render a mailbox name as an `in:` term. Lower-cased so it reads like the
 * operator it mimics, and quoted when the name has whitespace so the chip
 * stays one legible term.
 */
export function scopeLabelForMailboxName(name: string): string {
	const collapsed = name.trim().replace(/\s+/g, " ").toLowerCase();
	return /\s/.test(collapsed) ? `in:"${collapsed}"` : `in:${collapsed}`;
}

/**
 * The scope chip for the active route, or `undefined` on the daily brief —
 * the unscoped global view, which shows no chip.
 *
 * `mailboxName` is the sidebar's own label for the mailbox route (resolved by
 * `useCurrentMailboxName`). Until it resolves there is no chip rather than a
 * chip reading a raw uuid.
 */
export function searchScopeForRoute(
	matches: readonly MailRouteMatch[],
	mailboxName?: string | null,
): SearchScope | undefined {
	if (isBriefRoute(matches)) return undefined;
	if (isFlaggedRoute(matches)) {
		return { id: SEARCH_SCOPE_CHIP_ID, label: "is:starred" };
	}
	if (isOutboxRoute(matches)) {
		return { id: SEARCH_SCOPE_CHIP_ID, label: "in:outbox" };
	}
	if (mailboxName) {
		return {
			id: SEARCH_SCOPE_CHIP_ID,
			label: scopeLabelForMailboxName(mailboxName),
		};
	}
	return undefined;
}
