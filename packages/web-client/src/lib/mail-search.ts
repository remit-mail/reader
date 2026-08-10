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
 * "tolerated and ignored" means.
 */
export const briefSearchSchema = listSearch.extend({});

/** The same, for `/mail/flagged/<thread>/<message>`. */
export const flaggedSearchSchema = listSearch.extend({});

/**
 * The outbox's open message is a path segment
 * (`/mail/outbox/draft/<outboxMessageId>`), so the query carries nothing but
 * the search. An old link's selection param is dropped here.
 */
export const outboxSearchSchema = listSearch.extend({});

/**
 * A folder's open thread and the message inside it are path segments
 * (`/mail/<mailbox>/<thread>/<message>`), so the query carries nothing but the
 * search.
 */
export const mailboxSearchSchema = listSearch.extend({});

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
