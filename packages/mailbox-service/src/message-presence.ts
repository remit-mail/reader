import type { IImapConnection } from "./types.js";

/**
 * Whether a UID is confirmed gone from the currently open mailbox.
 *
 * A FETCH that yields no row is not proof of absence. imapflow drops rows on
 * back-to-back FETCHes (#408) — the same client glitch #100 had to stop
 * reading as authoritative on the sync path — so a transient blip returns an
 * empty result for a message that is still on the server. Anything that
 * deletes local rows on that reading destroys live mail.
 *
 * Absence is therefore confirmed with a UID SEARCH, which the server answers
 * with a plain UID set rather than a stream of message rows, and which
 * `placement-move-push.ts` already uses as its verification probe. Only a
 * SEARCH that does not list the UID counts as gone; an empty FETCH the SEARCH
 * contradicts leaves the message present, and the caller treats it as such.
 */
export const isMessageGoneFromOpenMailbox = async (
	connection: Pick<IImapConnection, "fetchMessages" | "search">,
	uid: number,
): Promise<boolean> => {
	const found = await connection.fetchMessages([uid]);
	if (found.length > 0) {
		return false;
	}

	const matched = await connection.search([["UID", String(uid)]]);
	return !matched.includes(uid);
};
