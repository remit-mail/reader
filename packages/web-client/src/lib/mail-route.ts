/**
 * Route detection for the /mail shell.
 *
 * `mail.tsx` mounts the right pane (brief, mailbox, or outbox) into
 * `AppShellSlotted` by inspecting the router's matched routes. The parent
 * `/mail` layout route is matched on EVERY child route, and its matched
 * `pathname` is "/mail" everywhere — so detection MUST key off each leaf
 * route's own `routeId`, never the parent pathname. Keying off "/mail"
 * pathname routed every mailbox through the brief pane, which renders the
 * unified DailyBrief instead of the mailbox MessageList — so the message
 * rows (the `a[href*=selectedMessageId]` anchors) vanished. These pure
 * predicates pin that contract.
 */

/** A matched route, minimal shape needed for pane detection. */
export interface MailRouteMatch {
	routeId: string;
	params?: Record<string, string | undefined>;
}

/** The leaf route ids the /mail shell branches on. */
export const MAIL_BRIEF_ROUTE_ID = "/mail/" as const;
export const MAIL_MAILBOX_ROUTE_ID = "/mail/$mailboxId" as const;
export const MAIL_OUTBOX_ROUTE_ID = "/mail/outbox" as const;
export const MAIL_FLAGGED_ROUTE_ID = "/mail/flagged" as const;

/** True only on the brief index route (/mail/), never on a mailbox/outbox. */
export function isBriefRoute(matches: readonly MailRouteMatch[]): boolean {
	return matches.some((m) => m.routeId === MAIL_BRIEF_ROUTE_ID);
}

/** True only on the flagged virtual-mailbox route (/mail/flagged). */
export function isFlaggedRoute(matches: readonly MailRouteMatch[]): boolean {
	return matches.some((m) => m.routeId === MAIL_FLAGGED_ROUTE_ID);
}

/** True only on the outbox route. */
export function isOutboxRoute(matches: readonly MailRouteMatch[]): boolean {
	return matches.some((m) => m.routeId === MAIL_OUTBOX_ROUTE_ID);
}

/** True only on a mailbox route (/mail/$mailboxId). */
export function isMailboxRoute(matches: readonly MailRouteMatch[]): boolean {
	return matches.some((m) => m.routeId === MAIL_MAILBOX_ROUTE_ID);
}

/**
 * Identity of the list view the shell is showing — one mailbox, the brief, the
 * flagged list, or the outbox. Two locations share a key when they differ only
 * in search params (opening a result, mirroring `q`), so opening a hit is not a
 * view change while switching mailbox is. `lib/search-view.ts` re-seeds the
 * search field whenever this changes.
 */
export function mailViewKey(matches: readonly MailRouteMatch[]): string {
	const mailboxId = matches.find((m) => m.params?.mailboxId)?.params?.mailboxId;
	if (mailboxId) return `${MAIL_MAILBOX_ROUTE_ID}:${mailboxId}`;
	if (isFlaggedRoute(matches)) return MAIL_FLAGGED_ROUTE_ID;
	if (isOutboxRoute(matches)) return MAIL_OUTBOX_ROUTE_ID;
	if (isBriefRoute(matches)) return MAIL_BRIEF_ROUTE_ID;
	return "";
}
