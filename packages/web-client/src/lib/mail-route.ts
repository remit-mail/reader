/**
 * Which list the router is showing.
 *
 * Every mail URL is a list plus, below it, whatever that list has open. The
 * list is a layout route, so the answer is a matched route id — never the
 * pathname, which is "/mail" on every child, and never the deepest match,
 * which is the thread. A thread opened from the brief and the brief itself are
 * the same list, so both must resolve here to the same answer.
 */

/** A matched route, minimal shape needed to identify the list. */
export interface MailRouteMatch {
	routeId: string;
	params?: Record<string, string | undefined>;
}

/** The list layout route ids. */
export const MAIL_BRIEF_ROUTE_ID = "/mail/brief" as const;
export const MAIL_MAILBOX_ROUTE_ID = "/mail/$mailboxId" as const;
export const MAIL_OUTBOX_ROUTE_ID = "/mail/outbox" as const;
export const MAIL_FLAGGED_ROUTE_ID = "/mail/flagged" as const;

/**
 * The list a location is browsing. A mailbox route carries its id, which is
 * absent only in the frame before the router has resolved the param.
 */
export type MailListRoute =
	| { list: "brief" }
	| { list: "flagged" }
	| { list: "outbox" }
	| { list: "mailbox"; mailboxId: string | undefined };

/**
 * The list layout among the matched routes, or `undefined` outside the mail
 * shell.
 *
 * Reads the shallowest list match, so anything mounted under a list — the open
 * thread, the message, the compose surface — leaves the answer alone.
 */
export function mailListRoute(
	matches: readonly MailRouteMatch[],
): MailListRoute | undefined {
	for (const match of matches) {
		if (match.routeId === MAIL_BRIEF_ROUTE_ID) return { list: "brief" };
		if (match.routeId === MAIL_FLAGGED_ROUTE_ID) return { list: "flagged" };
		if (match.routeId === MAIL_OUTBOX_ROUTE_ID) return { list: "outbox" };
		if (match.routeId === MAIL_MAILBOX_ROUTE_ID)
			return { list: "mailbox", mailboxId: match.params?.mailboxId };
	}
	return undefined;
}

/**
 * Identity of the list view the shell is showing — one mailbox, the brief, the
 * flagged list, or the outbox. Opening a thread is not a view change, so the
 * key of a list and of anything nested under it are equal; `lib/search-view.ts`
 * re-seeds the search field whenever this changes, and a key that moved when a
 * message opened would wipe the query the reader had just typed.
 */
export function mailViewKey(matches: readonly MailRouteMatch[]): string {
	const route = mailListRoute(matches);
	if (!route) return "";
	switch (route.list) {
		case "mailbox":
			return route.mailboxId
				? `${MAIL_MAILBOX_ROUTE_ID}:${route.mailboxId}`
				: "";
		case "flagged":
			return MAIL_FLAGGED_ROUTE_ID;
		case "outbox":
			return MAIL_OUTBOX_ROUTE_ID;
		case "brief":
			return MAIL_BRIEF_ROUTE_ID;
	}
}
