/**
 * The address a subscriber points its calendar client at (issue #1067).
 *
 * `webcal://` rather than `https://`: Apple Calendar, Outlook and Thunderbird
 * hand a `webcal:` link straight to their subscription dialog, where an https
 * one downloads a file that never refreshes. The host carries its port, so a
 * deployment that is not on 443 is subscribable on the same terms.
 */

const FEED_PATH_PREFIX = "/feeds/calendar/";
const FEED_PATH_SUFFIX = ".ics";

export const calendarFeedUrl = (host: string, feedToken: string): string =>
	`webcal://${host}${FEED_PATH_PREFIX}${feedToken}${FEED_PATH_SUFFIX}`;
