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
