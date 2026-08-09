/**
 * The search params each mail list validates.
 *
 * `q` lives on the parent `/mail` route, but a child's `validateSearch` is
 * authoritative for its own URL, so a child that omits `q` strips it: typing a
 * query on that list does nothing and the query is lost on the next navigation.
 * Every list extends the same base rather than re-declaring the param, so there
 * is one place for it to be right.
 */
import { z } from "zod";

/** What every list carries, whatever else it carries. */
const listSearch = z.object({ q: z.string().optional() });

/**
 * The brief's open thread and the message inside it are path segments
 * (`/mail/brief/<thread>/<message>`), so the query carries nothing but the
 * search. An old link's selection params are dropped here, which is what
 * "tolerated and ignored" means until the other three lists follow.
 */
export const briefSearchSchema = listSearch.extend({});

export const flaggedSearchSchema = listSearch.extend({
	selectedMessageId: z.string().optional(),
});

export const outboxSearchSchema = listSearch.extend({
	selectedOutboxMessageId: z.string().optional(),
});

export const mailboxSearchSchema = listSearch.extend({
	selectedMessageId: z.string().optional(),
	// A tapped semantic "Related" hit can point at a message outside the loaded
	// list; carrying its thread lets the mailbox open it directly (the mailbox is
	// the route param). See `buildConversationTarget`.
	selectedThreadId: z.string().optional(),
});

/**
 * `/mail` itself only redirects to the brief, so it accepts what the brief
 * accepts and hands it straight on.
 */
export const mailIndexSearchSchema = briefSearchSchema;

/** Every list's schema, by the path it validates. */
export const mailListSearchSchemas = {
	"/mail/brief": briefSearchSchema,
	"/mail/flagged": flaggedSearchSchema,
	"/mail/outbox": outboxSearchSchema,
	"/mail/$mailboxId": mailboxSearchSchema,
} as const;
