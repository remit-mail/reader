/**
 * Which list the router is showing, and whether a location still sits on one.
 *
 * Every mail URL is a list plus, below it, whatever that list has open. The
 * list is a layout route, so it is named by a matched route id: the parent
 * `/mail` match carries the pathname "/mail" on every child, and the deepest
 * match is the thread. A thread opened from the brief and the brief itself
 * resolve to the same list.
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
			return route.mailboxId ? mailboxViewKey(route.mailboxId) : "";
		case "flagged":
			return MAIL_FLAGGED_ROUTE_ID;
		case "outbox":
			return MAIL_OUTBOX_ROUTE_ID;
		case "brief":
			return MAIL_BRIEF_ROUTE_ID;
	}
}

/** One mailbox's view key. Two mailboxes are two views. */
export function mailboxViewKey(mailboxId: string): string {
	return `${MAIL_MAILBOX_ROUTE_ID}:${mailboxId}`;
}

/**
 * Whether a location sits on a list, or on something the list has open below it.
 *
 * Answers off the pathname rather than the matches on purpose. The router
 * commits the new location before it swaps the matches, so a component leaving
 * the screen sees its own matches under the destination's address for as long as
 * the destination takes to mount. `pathname` is what says where the reader is
 * going; `matches` is what says where they still are.
 *
 * `listPath` is a whole segment: a folder named `briefing` is not the brief.
 */
export function locationIsOnList(pathname: string, listPath: string): boolean {
	if (pathname === listPath) return true;
	return pathname.startsWith(`${listPath}/`);
}

/**
 * Whether the address names something the list has open below it — a thread, a
 * message, the compose surface. A list on its own, and its bare reading pane,
 * do not.
 *
 * Answers what an open thread used to be asked of the query. Anything sharing
 * the single pane with the conversation reads it from here rather than keeping a
 * second opinion about what is on screen.
 */
export function locationOpensDetail(pathname: string): boolean {
	const segments = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
	return segments[0] === "mail" && segments.length > 2;
}
