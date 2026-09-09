import type {
	CalendarFeedTokenItem,
	PutCalendarFeedTokenInput,
} from "../types.js";

export interface ICalendarFeedTokenRepository {
	/**
	 * Mints the calendar's feed address, or replaces the token it already has.
	 *
	 * One statement, and an upsert on the derived `feedTokenId`: a calendar holds
	 * exactly one active address, so there is no state in which a revoked token
	 * still resolves alongside its replacement. `createdAt` survives a
	 * replacement — the feed is the same feed under a new secret — and
	 * `rotatedAt` is stamped only when a row was already there, so a caller can
	 * tell a fresh address from a rotated one without a prior read.
	 */
	put(input: PutCalendarFeedTokenInput): Promise<CalendarFeedTokenItem>;
	/**
	 * The address a calendar holds, or `null` when it has none. Scoped by account
	 * config: a management read is always somebody's, and an unscoped one would
	 * answer for a calendar the caller does not own.
	 */
	findByCalendar(
		accountConfigId: string,
		calendarId: string,
	): Promise<CalendarFeedTokenItem | null>;
	/**
	 * The row a token hash names, or `null` when nothing answers to it.
	 *
	 * Deliberately unscoped, and the only read that is: a subscriber arrives with
	 * no session at all, so the hash is the whole lookup key and the row it finds
	 * is what names the owner. The caller still compares the stored hash against
	 * the presented one before serving anything.
	 */
	findByTokenHash(tokenHash: string): Promise<CalendarFeedTokenItem | null>;
	/** Revokes the calendar's address. Every subscribed client stops resolving. */
	delete(accountConfigId: string, calendarId: string): Promise<void>;
}
