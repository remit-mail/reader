import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	CalendarCollectionItem,
	CalendarObjectItem,
} from "@remit/data-ports";
import {
	buildCalendarFeed,
	CALENDAR_FEED_TOKEN_BYTES,
	calendarFeedIsUnchanged,
	calendarFeedIsUnmodifiedSince,
	calendarFeedPath,
	hashCalendarFeedToken,
	isCalendarFeedToken,
	mintCalendarFeedToken,
	readCalendarFeedToken,
	redactCalendarFeedPath,
} from "./feed.js";
import { AMSTERDAM_VTIMEZONE, ical, singleEvent } from "./fixtures.js";

const collection = (
	overrides: Partial<CalendarCollectionItem> = {},
): CalendarCollectionItem =>
	({
		calendarId: "cal-1",
		accountConfigId: "acc-1",
		urlSegment: "work",
		displayName: "Work",
		color: "Cal1",
		componentSet: "VeventOnly",
		source: "UserCreated",
		timezone: "",
		syncSequence: 3,
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		...overrides,
	}) as CalendarCollectionItem;

const object = (
	resourceName: string,
	icalData: string,
	updatedAt = 1_700_000_100_000,
): CalendarObjectItem =>
	({
		calendarObjectId: `obj-${resourceName}`,
		calendarId: "cal-1",
		resourceName,
		icalData,
		updatedAt,
	}) as CalendarObjectItem;

/** Content lines as a subscriber reads them, with RFC 5545 3.1 folding undone. */
const unfolded = (icalData: string): string =>
	icalData.replace(/\r\n[ \t]/g, "");

describe("a feed token", () => {
	it("is base64url over the declared number of random bytes", () => {
		const minted = mintCalendarFeedToken();

		assert.equal(
			Buffer.from(minted.token, "base64url").length,
			CALENDAR_FEED_TOKEN_BYTES,
		);
		assert.ok(isCalendarFeedToken(minted.token));
		assert.equal(minted.tokenHash, hashCalendarFeedToken(minted.token));
		assert.equal(minted.tokenHash.length, 64);
		assert.equal(
			minted.tokenHash.includes(minted.token),
			false,
			"the stored value is a digest, not the secret",
		);
	});

	it("is never the same twice", () => {
		const minted = new Set(
			Array.from({ length: 64 }, () => mintCalendarFeedToken().token),
		);

		assert.equal(minted.size, 64);
	});

	it("refuses anything that is not the shape of one", () => {
		for (const candidate of [
			"",
			"short",
			"a".repeat(42),
			"a".repeat(44),
			`${"a".repeat(42)}/`,
			`${"a".repeat(42)}.`,
			"../../etc/passwd",
		]) {
			assert.equal(isCalendarFeedToken(candidate), false, candidate);
		}
	});
});

describe("a feed address", () => {
	it("reads back the token it was written from", () => {
		const minted = mintCalendarFeedToken();

		assert.equal(
			readCalendarFeedToken(calendarFeedPath(minted.token)),
			minted.token,
		);
	});

	it("is not a feed address without the path and the suffix", () => {
		assert.equal(readCalendarFeedToken("/feeds/calendar/abc"), null);
		assert.equal(readCalendarFeedToken("/calendars/abc.ics"), null);
		assert.equal(readCalendarFeedToken("/feeds/calendar/a/b.ics"), null);
	});
});

describe("the calendar a feed serves", () => {
	it("names itself from the collection and terminates its last line", () => {
		const feed = buildCalendarFeed(collection({ displayName: "Team" }), [
			object(
				"a.ics",
				singleEvent("SUMMARY:Stand-up", "DTSTART:20260907T090000Z"),
			),
		]);

		assert.match(feed.icalData, /^BEGIN:VCALENDAR\r\n/);
		assert.match(feed.icalData, /X-WR-CALNAME:Team\r\n/);
		assert.match(feed.icalData, /END:VCALENDAR\r\n$/);
		assert.match(feed.icalData, /SUMMARY:Stand-up/);
	});

	it("escapes the separators a name may carry", () => {
		const feed = buildCalendarFeed(
			collection({ displayName: "Work, Home; C:\\shared" }),
			[],
		);

		assert.match(
			unfolded(feed.icalData),
			/X-WR-CALNAME:Work\\, Home\\; C:\\\\shared\r\n/,
		);
	});

	it("cannot be made to smuggle a component through its name", () => {
		const feed = buildCalendarFeed(
			collection({
				displayName:
					"Work\r\nBEGIN:VEVENT\r\nUID:injected\r\nDTSTART:20250101T000000Z\r\nSUMMARY:pwned\r\nEND:VEVENT",
			}),
			[
				object(
					"a.ics",
					singleEvent("SUMMARY:Stand-up", "DTSTART:20260907T090000Z"),
				),
			],
		);
		const served = unfolded(feed.icalData);

		assert.equal(served.match(/^BEGIN:VEVENT\r\n/gm)?.length, 1);
		assert.doesNotMatch(served, /^UID:injected/m);
		assert.doesNotMatch(served, /^SUMMARY:pwned/m);
		assert.match(served, /X-WR-CALNAME:Work\\nBEGIN:VEVENT\\nUID:injected/);
	});

	it("leaves no bare carriage return in what it serves", () => {
		const feed = buildCalendarFeed(
			collection({ displayName: "Work\rHome" }),
			[],
		);

		assert.match(unfolded(feed.icalData), /X-WR-CALNAME:Work\\nHome\r\n/);
		assert.doesNotMatch(feed.icalData, /\r(?!\n)/);
	});

	it("carries the collection's zone so a client reads floating times the same way", () => {
		const feed = buildCalendarFeed(
			collection({ timezone: "Europe/Amsterdam" }),
			[],
		);

		assert.match(feed.icalData, /X-WR-TIMEZONE:Europe\/Amsterdam\r\n/);
	});

	it("keeps the rule rather than the occurrences it would produce", () => {
		const feed = buildCalendarFeed(collection(), [
			object(
				"a.ics",
				singleEvent(
					"SUMMARY:Weekly",
					"DTSTART:20260907T090000Z",
					"RRULE:FREQ=WEEKLY;COUNT=5",
				),
			),
		]);

		assert.equal(feed.icalData.match(/BEGIN:VEVENT/g)?.length, 1);
		assert.match(feed.icalData, /RRULE:FREQ=WEEKLY;COUNT=5/);
	});

	it("carries one copy of a VTIMEZONE two resources both declare", () => {
		const withZone = (uid: string) =>
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"PRODID:-//Remit//Calendar Tests//EN",
				...AMSTERDAM_VTIMEZONE,
				"BEGIN:VEVENT",
				`UID:${uid}`,
				"DTSTAMP:20260801T090000Z",
				"DTSTART;TZID=Europe/Amsterdam:20260907T090000",
				"END:VEVENT",
				"END:VCALENDAR",
			);

		const feed = buildCalendarFeed(collection(), [
			object("a.ics", withZone("a@example.com")),
			object("b.ics", withZone("b@example.com")),
		]);

		assert.equal(feed.icalData.match(/BEGIN:VTIMEZONE/g)?.length, 1);
		assert.equal(feed.icalData.match(/BEGIN:VEVENT/g)?.length, 2);
	});

	it("declares one VERSION however many resources it gathered", () => {
		const feed = buildCalendarFeed(collection(), [
			object("a.ics", singleEvent("DTSTART:20260907T090000Z")),
			object("b.ics", singleEvent("DTSTART:20260908T090000Z")),
		]);

		assert.equal(feed.icalData.match(/^VERSION:/gm)?.length, 1);
		assert.equal(feed.icalData.match(/^PRODID:/gm)?.length, 1);
	});

	it("moves its tag when the bytes change and holds it when they do not", () => {
		const one = object("a.ics", singleEvent("DTSTART:20260907T090000Z"));
		const two = object("b.ics", singleEvent("DTSTART:20260908T090000Z"));

		const first = buildCalendarFeed(collection(), [one]);
		const again = buildCalendarFeed(collection(), [one]);
		const grown = buildCalendarFeed(collection(), [one, two]);
		const renamed = buildCalendarFeed(collection({ displayName: "Team" }), [
			one,
		]);

		assert.equal(again.etag, first.etag);
		assert.notEqual(grown.etag, first.etag);
		assert.notEqual(renamed.etag, first.etag);
	});

	it("carries no modification time of its own", () => {
		// The newest surviving event is not when the calendar last changed: a
		// delete removes the newest one and leaves every survivor older than the
		// change. The collection's own timestamp is what the feed serves, and it
		// belongs to the store rather than to these bytes (issue #1067).
		const feed = buildCalendarFeed(collection({ updatedAt: 500 }), [
			object("a.ics", singleEvent("DTSTART:20260907T090000Z"), 900),
		]);

		assert.deepEqual(Object.keys(feed).sort(), ["etag", "icalData"]);
	});
});

describe("a conditional poll", () => {
	it("is unchanged for the tag it holds, quoted, weak or in a list", () => {
		for (const header of ['"abc"', "abc", 'W/"abc"', '"other", "abc"', "*"]) {
			assert.ok(calendarFeedIsUnchanged(header, "abc"), String(header));
		}
	});

	it("is changed with no header, an empty one, or somebody else's tag", () => {
		for (const header of [undefined, "", '"other"', 'W/"other"']) {
			assert.equal(
				calendarFeedIsUnchanged(header, "abc"),
				false,
				String(header),
			);
		}
	});
});

describe("a feed path in a log line", () => {
	it("keeps the route and drops the token", () => {
		const minted = mintCalendarFeedToken();

		const redacted = redactCalendarFeedPath(calendarFeedPath(minted.token));

		assert.equal(redacted.includes(minted.token), false);
		assert.equal(redacted, "/feeds/calendar/<redacted>.ics");
	});

	it("leaves a path that carries no token alone", () => {
		for (const path of [
			"/calendars/abc",
			"/feeds/calendar/no-suffix",
			"/health",
		]) {
			assert.equal(redactCalendarFeedPath(path), path, path);
		}
	});
});

describe("a poll carrying a date", () => {
	const lastModified = Date.UTC(2026, 8, 7, 9, 0, 0);

	it("is unmodified for the second it was last written in", () => {
		// Last-Modified went out truncated to the second, so the value that comes
		// back is 750ms behind the stored timestamp and still means "the copy I
		// have is the one you served".
		assert.ok(
			calendarFeedIsUnmodifiedSince(
				new Date(lastModified).toUTCString(),
				lastModified + 750,
			),
		);
	});

	it("is modified once the calendar moves into a later second", () => {
		assert.equal(
			calendarFeedIsUnmodifiedSince(
				new Date(lastModified).toUTCString(),
				lastModified + 1000,
			),
			false,
		);
	});

	it("is not a condition when the date is absent or unreadable", () => {
		for (const header of [undefined, "", "whenever"]) {
			assert.equal(
				calendarFeedIsUnmodifiedSince(header, lastModified),
				false,
				String(header),
			);
		}
	});
});
