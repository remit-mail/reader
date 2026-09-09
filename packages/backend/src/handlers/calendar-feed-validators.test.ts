/**
 * Issue #1067: which timestamp a feed's validators are taken from.
 *
 * Driven against a store rather than through the API, because the decision only
 * shows when the collection and the events in it carry times a test running
 * inside one second cannot produce: here the calendar is stamped an hour after
 * its newest surviving event, which is the shape a delete leaves behind.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	hashCalendarFeedToken,
	mintCalendarFeedToken,
	putCalendarObject,
} from "@remit/calendar-service";
import { MemoryCalendarStore } from "@remit/calendar-service/memory-store";
import type { CalendarDeps } from "./calendar.js";
import { serveCalendarFeed } from "./calendar-feed.js";

const ACCOUNT_CONFIG_ID = "feed-validators-account";
const EVENT_WRITTEN_AT = Date.UTC(2026, 8, 7, 9, 0, 0);
const CALENDAR_TOUCHED_AT = Date.UTC(2026, 8, 7, 10, 0, 0);

const ICAL = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//test//test//EN",
	"BEGIN:VEVENT",
	"UID:kept@test",
	"DTSTAMP:20260907T090000Z",
	"DTSTART:20260907T090000Z",
	"DTEND:20260907T100000Z",
	"SUMMARY:Kept",
	"END:VEVENT",
	"END:VCALENDAR",
].join("\r\n");

const depsOf = (store: MemoryCalendarStore): Promise<CalendarDeps> =>
	store.transaction(async (repos) => ({
		...repos,
		calendarUnitOfWork: store,
	}));

const tokenFor = async (
	store: MemoryCalendarStore,
	calendarId: string,
): Promise<string> => {
	const minted = mintCalendarFeedToken();
	await store.transaction(async (repos) =>
		repos.calendarFeedToken.put({
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			tokenHash: minted.tokenHash,
		}),
	);
	return minted.token;
};

interface Fixture {
	deps: CalendarDeps;
	token: string;
	readonly listedCollections: number;
}

const fixture = async (): Promise<Fixture> => {
	const store = new MemoryCalendarStore();
	const deps = await depsOf(store);

	const collection = await store.transaction(async (repos) =>
		repos.calendarCollection.create({
			accountConfigId: ACCOUNT_CONFIG_ID,
			urlSegment: "work",
			displayName: "Work",
		}),
	);

	const written = await putCalendarObject(store, {
		accountConfigId: ACCOUNT_CONFIG_ID,
		calendarId: collection.calendarId,
		resourceName: "kept.ics",
		icalData: ICAL,
	});
	assert.ok(written.ok, "the fixture's own event has to be storable");

	// The shape a delete leaves: the calendar was stamped by the delete, and every
	// event still in it is older than that.
	store.objects.set(written.value.calendarObjectId, {
		...written.value,
		updatedAt: EVENT_WRITTEN_AT,
	});
	const bumped = store.collections.get(collection.calendarId);
	assert.ok(bumped, "the write should have stamped the collection");
	store.collections.set(collection.calendarId, {
		...bumped,
		updatedAt: CALENDAR_TOUCHED_AT,
	});

	const token = await tokenFor(store, collection.calendarId);

	let listedCollections = 0;
	const counted: CalendarDeps = {
		...deps,
		calendarCollection: {
			...deps.calendarCollection,
			listByAccountConfig: async (accountConfigId: string) => {
				listedCollections += 1;
				return deps.calendarCollection.listByAccountConfig(accountConfigId);
			},
		},
	};

	return {
		deps: counted,
		token,
		get listedCollections() {
			return listedCollections;
		},
	};
};

const NO_CONDITIONS = { ifNoneMatch: undefined, ifModifiedSince: undefined };

describe("the validators a feed serves", () => {
	it("dates the calendar by its own last change, not by its newest event", async () => {
		const { deps, token } = await fixture();

		const served = await serveCalendarFeed(deps, token, NO_CONDITIONS);

		assert.equal(served.statusCode, 200);
		assert.match(served.body, /SUMMARY:Kept/);
		assert.equal(
			served.headers["Last-Modified"],
			new Date(CALENDAR_TOUCHED_AT).toUTCString(),
			"a delete takes the newest event, so every survivor is older than the change",
		);
	});

	it("is unchanged for the date it served and changed for the one before it", async () => {
		const { deps, token } = await fixture();
		const served = await serveCalendarFeed(deps, token, NO_CONDITIONS);
		const lastModified = served.headers["Last-Modified"];

		const unchanged = await serveCalendarFeed(deps, token, {
			ifNoneMatch: undefined,
			ifModifiedSince: lastModified,
		});
		const stale = await serveCalendarFeed(deps, token, {
			ifNoneMatch: undefined,
			ifModifiedSince: new Date(CALENDAR_TOUCHED_AT - 1000).toUTCString(),
		});

		assert.equal(unchanged.statusCode, 304);
		assert.equal(unchanged.body, "");
		assert.equal(unchanged.headers["Last-Modified"], lastModified);
		assert.equal(unchanged.headers.ETag, served.headers.ETag);
		assert.equal(stale.statusCode, 200);
	});

	it("lets a tag that arrives settle the answer on its own", async () => {
		// RFC 9110 13.2.2: the date is not consulted when a tag is present, so a
		// tag nobody served re-sends the calendar however current the date is.
		const { deps, token } = await fixture();
		const served = await serveCalendarFeed(deps, token, NO_CONDITIONS);

		const overridden = await serveCalendarFeed(deps, token, {
			ifNoneMatch: '"not-the-tag"',
			ifModifiedSince: served.headers["Last-Modified"],
		});

		assert.equal(overridden.statusCode, 200);
		assert.match(overridden.body, /SUMMARY:Kept/);
	});

	it("reads the one collection it needs rather than every collection there is", async () => {
		const found = await fixture();

		await serveCalendarFeed(found.deps, found.token, NO_CONDITIONS);

		assert.equal(
			found.listedCollections,
			0,
			"a feed poll is the hot path and the token already names its collection",
		);
	});

	it("is absent when the token outlives the calendar it named", async () => {
		const store = new MemoryCalendarStore();
		const deps = await depsOf(store);
		const token = await tokenFor(store, "a-calendar-that-is-gone");

		const served = await serveCalendarFeed(deps, token, NO_CONDITIONS);

		assert.equal(served.statusCode, 404);
		assert.equal(
			served.body.includes("BEGIN:VCALENDAR"),
			false,
			"a blank calendar would be worse than saying nothing",
		);
	});

	it("is absent for an unknown, a malformed and an oversize token alike", async () => {
		const store = new MemoryCalendarStore();
		const deps = await depsOf(store);

		const unknown = await serveCalendarFeed(
			deps,
			mintCalendarFeedToken().token,
			NO_CONDITIONS,
		);
		const malformed = await serveCalendarFeed(deps, "nope", NO_CONDITIONS);
		const oversize = await serveCalendarFeed(
			deps,
			"z".repeat(600),
			NO_CONDITIONS,
		);

		for (const served of [unknown, malformed, oversize]) {
			assert.equal(served.statusCode, 404);
			assert.equal(served.body, unknown.body);
		}
		assert.equal(
			hashCalendarFeedToken("nope").length,
			64,
			"the digest is what the store is asked about, never the token",
		);
	});
});
