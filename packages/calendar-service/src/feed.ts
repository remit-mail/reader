import { createHash, randomBytes } from "node:crypto";
import type {
	CalendarCollectionItem,
	CalendarObjectItem,
} from "@remit/data-ports";
import ICAL from "ical.js";
import { CALENDAR_PRODID } from "./build.js";
import { computeEtag } from "./etag.js";
import { serializeCalendar } from "./parse.js";

/** Random bytes behind a feed token (issue #1067). */
export const CALENDAR_FEED_TOKEN_BYTES = 32;

/** Where a feed lives, as the one place the shape of that path is written. */
export const CALENDAR_FEED_PATH_PREFIX = "/feeds/calendar/";
export const CALENDAR_FEED_PATH_SUFFIX = ".ics";

/** base64url over `CALENDAR_FEED_TOKEN_BYTES`, so the length is fixed. */
const TOKEN_LENGTH = Math.ceil((CALENDAR_FEED_TOKEN_BYTES * 4) / 3);
const TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`);

/** A minted feed address: the secret, handed out once, and what is stored. */
export interface CalendarFeedSecret {
	token: string;
	tokenHash: string;
}

export const hashCalendarFeedToken = (token: string): string =>
	createHash("sha256").update(token, "utf8").digest("hex");

/**
 * A fresh feed token and the hash that will stand in for it.
 *
 * 32 random bytes rather than a stretched password: nothing about this value is
 * user-chosen, so there is no dictionary to search and a slow hash would only
 * tax every poll of every subscribed client.
 */
export const mintCalendarFeedToken = (): CalendarFeedSecret => {
	const token = randomBytes(CALENDAR_FEED_TOKEN_BYTES).toString("base64url");
	return { token, tokenHash: hashCalendarFeedToken(token) };
};

/**
 * Whether a path segment can be a feed token at all.
 *
 * Checked before anything is hashed or read, so a request carrying a megabyte
 * of path or a `../` never reaches the store. A refusal here is the same 404 a
 * revoked token gets — the caller learns nothing from the difference.
 */
export const isCalendarFeedToken = (token: string): boolean =>
	TOKEN_SHAPE.test(token);

/**
 * The token a request path carries, or `null` when the path is not a feed
 * address. One segment only: a slash inside it would name a different route.
 */
export const readCalendarFeedToken = (path: string): string | null => {
	if (!path.startsWith(CALENDAR_FEED_PATH_PREFIX)) return null;
	if (!path.endsWith(CALENDAR_FEED_PATH_SUFFIX)) return null;
	const token = path.slice(
		CALENDAR_FEED_PATH_PREFIX.length,
		-CALENDAR_FEED_PATH_SUFFIX.length,
	);
	if (token.includes("/")) return null;
	return token;
};

/**
 * The feed path with its token taken out, for a log line or a metric label.
 *
 * The token is the whole credential, so a path that carries one is not a field
 * that can be recorded. Redacted rather than dropped: which route was served is
 * what an operator reads a log for, and a blank path loses that too.
 */
export const redactCalendarFeedPath = (path: string): string =>
	readCalendarFeedToken(path) === null
		? path
		: `${CALENDAR_FEED_PATH_PREFIX}<redacted>${CALENDAR_FEED_PATH_SUFFIX}`;

/**
 * A TEXT value as RFC 5545 3.3.11 writes one.
 *
 * ical.js escapes TEXT only for the properties in its design set, and no `X-`
 * property is in it, so a value goes out verbatim: a comma or a semicolon
 * reads back as a value list, and a line break as the start of a whole
 * component the subscriber never had. TEXT has no encoding for a control
 * character, so one is dropped rather than served.
 */
const escapeIcalText = (value: string): string =>
	value
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r\n|\r|\n/g, "\\n")
		// biome-ignore lint/suspicious/noControlCharactersInRegex: RFC 5545 TEXT excludes CONTROL.
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

/** The bytes a feed serves, and what a conditional request needs to skip them. */
export interface CalendarFeed {
	icalData: string;
	etag: string;
}

/**
 * One VCALENDAR carrying every event in a collection.
 *
 * The stored components are copied across as they are: a recurring event
 * travels as its master plus its RRULE, never as an expansion, because a
 * subscriber renders occurrences itself and expects to keep doing so past any
 * horizon this server would have chosen. VTIMEZONE definitions come along for
 * the same reason — without them a client reads a TZID it cannot resolve.
 *
 * `X-WR-CALNAME` is a property of the calendar, not of the response: Apple
 * Calendar, Google Calendar and Thunderbird all name a subscription from it.
 */
export const buildCalendarFeed = (
	collection: CalendarCollectionItem,
	objects: readonly CalendarObjectItem[],
): CalendarFeed => {
	const feed = new ICAL.Component("vcalendar");
	feed.updatePropertyWithValue("prodid", CALENDAR_PRODID);
	feed.updatePropertyWithValue("version", "2.0");
	feed.updatePropertyWithValue("calscale", "GREGORIAN");
	feed.updatePropertyWithValue(
		"x-wr-calname",
		escapeIcalText(collection.displayName),
	);
	if (collection.timezone !== "") {
		feed.updatePropertyWithValue(
			"x-wr-timezone",
			escapeIcalText(collection.timezone),
		);
	}

	const zonesSeen = new Set<string>();
	for (const object of objects) {
		const stored = new ICAL.Component(ICAL.parse(object.icalData));
		// A copy of the list, not the list: adding a component reparents it,
		// which splices it out of the array `getAllSubcomponents` handed back and
		// would drop whatever followed it.
		for (const child of [...stored.getAllSubcomponents()]) {
			if (child.name === "vtimezone") {
				const tzid = child.getFirstPropertyValue("tzid");
				const key = typeof tzid === "string" ? tzid : "";
				if (zonesSeen.has(key)) continue;
				zonesSeen.add(key);
			}
			feed.addSubcomponent(child);
		}
	}

	// ical.js leaves the last content line unterminated. Every line in an
	// iCalendar stream ends with CRLF (RFC 5545 3.1), END:VCALENDAR included.
	const serialized = serializeCalendar(feed);
	const icalData = serialized.endsWith("\r\n")
		? serialized
		: `${serialized}\r\n`;
	return { icalData, etag: computeEtag(icalData) };
};

/**
 * Whether an `If-None-Match` covers the tag the feed would serve.
 *
 * Accepts the weak form and `*`, and reads the header as the list RFC 9110
 * 13.1.2 says it is — a subscriber that has polled through a proxy may get its
 * own tag back with a `W/` on it, and answering 200 to that resends the whole
 * calendar for nothing.
 */
export const calendarFeedIsUnchanged = (
	ifNoneMatch: string | undefined,
	etag: string,
): boolean => {
	if (ifNoneMatch === undefined || ifNoneMatch === "") return false;
	if (ifNoneMatch.trim() === "*") return true;
	return ifNoneMatch
		.split(",")
		.map((candidate) =>
			candidate.trim().replace(/^W\//, "").replace(/^"|"$/g, ""),
		)
		.includes(etag);
};

/**
 * Whether the calendar has stood still since the date an `If-Modified-Since`
 * carries.
 *
 * Compared at whole seconds, which is the resolution an HTTP-date has: a
 * `Last-Modified` served from a millisecond timestamp is rounded down on the
 * way out, and comparing the unrounded value against what comes back declares
 * every calendar modified within the second it was last written.
 *
 * An unreadable date is not a condition (RFC 9110 13.1.3) — the full calendar
 * is served rather than a 304 nobody asked for.
 */
export const calendarFeedIsUnmodifiedSince = (
	ifModifiedSince: string | undefined,
	lastModifiedAt: number,
): boolean => {
	if (ifModifiedSince === undefined || ifModifiedSince === "") return false;
	const since = Date.parse(ifModifiedSince);
	if (Number.isNaN(since)) return false;
	return Math.floor(lastModifiedAt / 1000) * 1000 <= since;
};
