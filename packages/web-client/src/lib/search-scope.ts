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
import type { FolderRole, SearchScope as ResultsScope } from "@remit/ui";
import {
	isBriefRoute,
	isFlaggedRoute,
	isMailboxRoute,
	isOutboxRoute,
	MAIL_MAILBOX_ROUTE_ID,
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
 * The mailbox id carried by a mailbox route, or `undefined` on any other route.
 */
export function routeMailboxId(
	matches: readonly MailRouteMatch[],
): string | undefined {
	return matches.find((m) => m.routeId === MAIL_MAILBOX_ROUTE_ID)?.params
		?.mailboxId;
}

/**
 * The mailbox every engine on the active route must be pinned to.
 *
 * No chip means global; a chip means nothing on the route reaches past it. The
 * semantic engine used to run unscoped inside a mailbox under an "Everywhere"
 * heading, which contradicted the `in:` chip the same bar was showing, so the
 * scope is now resolved from the route here rather than left to each caller:
 *
 *  - A mailbox route pins to its own mailbox. It beats both the caller's
 *    argument and a typed `in:`, so no call site can widen or redirect it.
 *  - Any other scoped route (flagged, outbox) never falls back to a typed
 *    `in:`. Its scope is a collection rather than a folder, which the semantic
 *    API cannot express — which is why neither view runs a semantic section
 *    today. Honouring `in:` there would be a search reaching past a chip that
 *    promises otherwise.
 *  - An unscoped route (the daily brief) is global unless a typed `in:` narrows
 *    it, which is the one place `useSearchTokenContext` resolves that term.
 */
export function semanticMailboxScope(args: {
	matches: readonly MailRouteMatch[];
	callerMailboxId?: string;
	inTokenMailboxId?: string;
}): string | undefined {
	const fromRoute = routeMailboxId(args.matches);
	if (fromRoute) return fromRoute;
	if (isScopedRoute(args.matches)) return args.callerMailboxId;
	return args.callerMailboxId ?? args.inTokenMailboxId;
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

/**
 * The route's scope as the results list understands it.
 *
 * The list knows two states, because two are all it acts on: a global search
 * names the folder each row came from and offers the spam it held out, and a
 * folder search does neither. The bar's third state, `pending`, is a mailbox
 * route whose name has not loaded — it maps to `folder` (with no role yet)
 * because the list underneath is already one mailbox, and calling it global for
 * that one frame would flash folder labels and a spam offer and then retract
 * them.
 *
 * `role` is the appointed role of the mailbox the route is on, which is what
 * makes a search scoped to Spam show its rows instead of dropping them. Scoped
 * routes that are collections rather than folders (flagged, outbox) carry no
 * role, and neither does a folder nobody appointed.
 */
export function resultsScopeForState(
	state: SearchScopeState,
	role?: FolderRole,
): ResultsScope {
	if (state.kind === "global") return { kind: "global" };
	return { kind: "folder", ...(role ? { role } : {}) };
}
