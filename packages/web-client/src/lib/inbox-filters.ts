import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { toDisplayCategory } from "./display-category.js";

/**
 * Inbox filter predicates — the inbox preset offers Unread / Starred / Has
 * attachment (never accounts; an inbox is one account already). The `flagged`
 * id is the wire name for IMAP \Flagged; the label is "Starred".
 */
const INBOX_FILTER_PREDICATES: Record<
	string,
	(t: RemitImapThreadMessageResponse) => boolean
> = {
	unread: (t) => !t.isRead,
	flagged: (t) => t.hasStars === true,
	attachment: (t) => Boolean(t.hasAttachment),
};

/**
 * Narrow the loaded threads to one category and a set of attributes. Applied
 * over the loaded pages until #306 moves the predicate into the query.
 *
 * The category comparison goes through `toDisplayCategory` so the inbox agrees
 * with Starred and the brief, which filter mapped rows. `category` is optional
 * on the response and absent reads as `uncategorized` everywhere else — a
 * pre-classification thread renders an `uncategorized` badge, so a raw
 * comparison made the row you can see vanish under its own chip (#45).
 */
export function applyInboxFilters(
	threads: RemitImapThreadMessageResponse[],
	category: string,
	attributes: ReadonlySet<string>,
): RemitImapThreadMessageResponse[] {
	const predicates = Array.from(attributes)
		.map((id) => INBOX_FILTER_PREDICATES[id])
		.filter(
			(p): p is (t: RemitImapThreadMessageResponse) => boolean => p != null,
		);
	if (category === "all" && predicates.length === 0) return threads;
	return threads.filter(
		(t) =>
			(category === "all" || toDisplayCategory(t.category) === category) &&
			predicates.every((p) => p(t)),
	);
}
