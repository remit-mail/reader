/**
 * URL shapes the specs wait on.
 *
 * The four lists are siblings under `/mail`, so a bare `\/mail\/[a-z0-9]+`
 * matches `/mail/brief` as readily as a folder — a wait written that way is
 * already satisfied on the brief and lets a spec go on clicking rows in the
 * wrong list. These exclude the literal lists.
 */

/** A folder: `/mail/<mailboxId>`, never one of the named lists. */
export const MAILBOX_URL = /\/mail\/(?!brief|flagged|outbox)[^/?#]+/;

/** The daily brief, where `/mail` and `/` both land. */
export const BRIEF_URL = /\/mail\/brief(\?|$)/;
