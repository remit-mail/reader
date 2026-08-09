/**
 * URL shapes the specs wait on.
 *
 * The four lists are siblings under `/mail`, so a bare `\/mail\/[a-z0-9]+`
 * matches `/mail/brief` as readily as a folder — a wait written that way is
 * already satisfied on the brief and lets a spec go on clicking rows in the
 * wrong list. These exclude the literal lists.
 */

/**
 * A folder: `/mail/<mailboxId>`, never one of the named lists. The lookahead
 * spans a whole segment, so a folder genuinely named `briefing` still counts.
 */
export const MAILBOX_URL =
	/\/mail\/(?!(?:brief|flagged|outbox)(?:[/?#]|$))[^/?#]+/;

/** The daily brief, where `/mail` and `/` both land. */
export const BRIEF_URL = /\/mail\/brief(\?|$)/;

/**
 * A conversation open in the brief. The thread is a path segment, so "is a
 * thread open" is a question about the address rather than about a param.
 */
export const BRIEF_THREAD_URL = /\/mail\/brief\/[^/?#]+/;
