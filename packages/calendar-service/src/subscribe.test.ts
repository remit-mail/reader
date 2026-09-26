import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { CalendarCollectionItem } from "@remit/data-ports";
import { CalendarSource } from "@remit/domain-enums";
import { ical } from "./fixtures.js";
import { MemoryCalendarStore } from "./memory-store.js";
import { parseCalendar } from "./parse.js";
import {
	type CalendarFeedFetcher,
	fetchCalendarFeed,
	isSubscriptionDue,
	readSubscriptionUrl,
	refreshCalendarSubscription,
	splitCalendarFeed,
	writeCalendarFeed,
} from "./subscribe.js";
import { listCalendarInstances } from "./window.js";

const ACCOUNT_CONFIG_ID = "account-config-1";
const SECRET_URL =
	"https://calendar.example/calendar/ical/harbour%40example.com/private-5f1c0ffee/basic.ics";
const GOOGLE_FEED = readFileSync(
	new URL("./feeds/google-secret-address.ics", import.meta.url),
	"utf8",
);
const WINDOW = {
	from: "2026-10-01T00:00:00Z",
	to: "2026-11-16T00:00:00Z",
};

const answering =
	(body: string, init: ResponseInit = {}): CalendarFeedFetcher =>
	async () =>
		new Response(body, init);

const subscribed = async (): Promise<{
	store: MemoryCalendarStore;
	collection: CalendarCollectionItem;
}> => {
	const store = new MemoryCalendarStore();
	const collection = await store.transaction((repos) =>
		repos.calendarCollection.create({
			accountConfigId: ACCOUNT_CONFIG_ID,
			urlSegment: "harbour-rota",
			displayName: "Harbour rota",
			source: CalendarSource.Subscribed,
			subscriptionUrl: SECRET_URL,
			subscriptionEnabled: true,
		}),
	);
	return { store, collection };
};

const drawn = async (
	store: MemoryCalendarStore,
	collection: CalendarCollectionItem,
) => {
	const current = await store.transaction((repos) =>
		repos.calendarCollection.get(ACCOUNT_CONFIG_ID, collection.calendarId),
	);
	const instances = await store.transaction((repos) =>
		listCalendarInstances(repos, [current], WINDOW),
	);
	return instances.map((instance) => ({
		summary: instance.summary,
		startAt: instance.startAt,
		allDay: instance.allDay,
		status: instance.status,
	}));
};

const writeFeed = async (
	store: MemoryCalendarStore,
	collection: CalendarCollectionItem,
	feed: string,
	now: number,
) => {
	const split = await splitCalendarFeed(feed);
	assert.ok(split.ok);
	return writeCalendarFeed(
		store,
		{
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId: collection.calendarId,
		},
		split.value,
		now,
	);
};

describe("readSubscriptionUrl", () => {
	it("reads webcal as the same address over https", () => {
		const url = readSubscriptionUrl(
			"  webcal://calendar.example/feeds/rota.ics ",
		);
		assert.deepEqual(url, {
			ok: true,
			value: "https://calendar.example/feeds/rota.ics",
		});
	});

	it("keeps http and https as given", () => {
		assert.deepEqual(readSubscriptionUrl("http://127.0.0.1:8080/a.ics"), {
			ok: true,
			value: "http://127.0.0.1:8080/a.ics",
		});
		assert.deepEqual(readSubscriptionUrl(SECRET_URL), {
			ok: true,
			value: SECRET_URL,
		});
	});

	it("refuses what is not a web address", () => {
		for (const raw of [
			"",
			"calendar.example/rota.ics",
			"ftp://calendar.example/rota.ics",
			"file:///etc/passwd",
			"https://user:secret@calendar.example/rota.ics",
		]) {
			const url = readSubscriptionUrl(raw);
			assert.equal(url.ok, false, raw);
			if (!url.ok) assert.equal(url.error.code, "InvalidSubscriptionUrl");
		}
	});
});

describe("fetchCalendarFeed", () => {
	it("answers the feed's text", async () => {
		const fetched = await fetchCalendarFeed(
			SECRET_URL,
			answering(GOOGLE_FEED, { status: 200 }),
		);
		assert.deepEqual(fetched, { ok: true, value: GOOGLE_FEED });
	});

	it("names the status of a refusal and never the address", async () => {
		const fetched = await fetchCalendarFeed(
			SECRET_URL,
			answering("gone", { status: 404 }),
		);
		assert.deepEqual(fetched, {
			ok: false,
			reason: "the feed answered HTTP 404",
		});
	});

	it("names why an address could not be reached, without the address", async () => {
		const fetched = await fetchCalendarFeed(SECRET_URL, async (url) => {
			throw new TypeError("fetch failed", {
				cause: Object.assign(new Error(`connect ECONNREFUSED ${url}`), {
					code: "ECONNREFUSED",
				}),
			});
		});
		assert.deepEqual(fetched, {
			ok: false,
			reason: "the feed could not be reached (ECONNREFUSED)",
		});
	});

	it("says so when the feed does not answer in time", async () => {
		const fetched = await fetchCalendarFeed(SECRET_URL, async () => {
			throw new DOMException("timed out", "TimeoutError");
		});
		assert.deepEqual(fetched, {
			ok: false,
			reason: "the feed did not answer within 30 seconds",
		});
	});

	it("stops reading a chunked feed once it passes the cap", async () => {
		let pulled = 0;
		let cancelled = false;
		const chunk = new Uint8Array(1024 * 1024).fill(0x41);
		const endless = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				controller.enqueue(chunk);
			},
			cancel() {
				cancelled = true;
			},
		});

		const fetched = await fetchCalendarFeed(SECRET_URL, async () => {
			const response = new Response(endless, { status: 200 });
			assert.equal(response.headers.get("content-length"), null);
			return response;
		});

		assert.deepEqual(fetched, {
			ok: false,
			reason: "the feed is larger than 10 MB",
		});
		assert.equal(cancelled, true);
		assert.ok(pulled <= 12, `read ${pulled} MB of a feed capped at 10`);
	});

	it("refuses a feed larger than it will store", async () => {
		const fetched = await fetchCalendarFeed(
			SECRET_URL,
			answering("x", {
				status: 200,
				headers: { "content-length": String(64 * 1024 * 1024) },
			}),
		);
		assert.deepEqual(fetched, {
			ok: false,
			reason: "the feed is larger than 10 MB",
		});
	});
});

describe("splitCalendarFeed", () => {
	it("cuts a feed into one resource per UID, each one the write path accepts", async () => {
		const split = await splitCalendarFeed(GOOGLE_FEED);
		assert.ok(split.ok);
		assert.equal(split.value.unreadable, 0);
		assert.deepEqual(
			split.value.resources.map((resource) => resource.uid),
			[
				"pilot-standup@google.com",
				"quay-offsite@google.com",
				"tide-review@google.com",
			],
		);

		for (const resource of split.value.resources) {
			assert.match(resource.resourceName, /^[0-9a-f]{40}\.ics$/);
			const parsed = await parseCalendar(resource.icalData);
			assert.ok(parsed.ok, resource.uid);
			assert.equal(parsed.value.uid, resource.uid);
		}
	});

	it("keeps a series with its overrides and only the zones it names", async () => {
		const split = await splitCalendarFeed(GOOGLE_FEED);
		assert.ok(split.ok);
		const standup = split.value.resources[0];
		assert.ok(standup);

		const parsed = await parseCalendar(standup.icalData);
		assert.ok(parsed.ok);
		assert.equal(parsed.value.overrides.length, 2);
		assert.deepEqual(
			parsed.value.component
				.getAllSubcomponents("vtimezone")
				.map((zone) => zone.getFirstPropertyValue("tzid")),
			["Europe/Amsterdam"],
		);
		assert.equal(parsed.value.component.hasProperty("method"), false);
		assert.equal(
			parsed.value.component.getFirstPropertyValue("x-wr-calname"),
			"Harbour rota",
		);

		const offsite = split.value.resources[1];
		assert.ok(offsite);
		assert.doesNotMatch(offsite.icalData, /BEGIN:VTIMEZONE/);
	});

	it("names the same resource on every read of the same feed", async () => {
		const first = await splitCalendarFeed(GOOGLE_FEED);
		const second = await splitCalendarFeed(GOOGLE_FEED);
		assert.ok(first.ok && second.ok);
		assert.deepEqual(first.value.resources, second.value.resources);
	});

	it("counts an event with no UID instead of storing it", async () => {
		const split = await splitCalendarFeed(
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"PRODID:-//Example//Feed//EN",
				"BEGIN:VEVENT",
				"DTSTART:20261008T140000Z",
				"SUMMARY:Nobody's event",
				"END:VEVENT",
				"END:VCALENDAR",
			),
		);
		assert.ok(split.ok);
		assert.equal(split.value.resources.length, 0);
		assert.equal(split.value.unreadable, 1);
	});

	it("refuses bytes that are not a calendar", async () => {
		const split = await splitCalendarFeed(
			"<!doctype html><title>Sign in</title>",
		);
		assert.equal(split.ok, false);
	});
});

describe("writeCalendarFeed", () => {
	it("keeps recurrence, a moved and a cancelled instance, all-day and zoned times", async () => {
		const { store, collection } = await subscribed();

		const write = await writeFeed(store, collection, GOOGLE_FEED, 5_000);

		assert.deepEqual(write, {
			paused: false,
			written: 3,
			unchanged: 0,
			removed: 0,
			skipped: 0,
		});
		assert.deepEqual(await drawn(store, collection), [
			{
				summary: "Pilot standup",
				startAt: "2026-10-05T07:00:00Z",
				allDay: false,
				status: "Confirmed",
			},
			{
				summary: "Quay offsite",
				startAt: "2026-10-07T00:00:00Z",
				allDay: true,
				status: "Confirmed",
			},
			{
				summary: "Tide table review",
				startAt: "2026-10-08T14:00:00Z",
				allDay: false,
				status: "Confirmed",
			},
			{
				summary: "Pilot standup (moved)",
				startAt: "2026-10-12T08:00:00Z",
				allDay: false,
				status: "Confirmed",
			},
			{
				summary: "Pilot standup",
				startAt: "2026-10-26T08:00:00Z",
				allDay: false,
				status: "Confirmed",
			},
			{
				summary: "Pilot standup",
				startAt: "2026-11-02T08:00:00Z",
				allDay: false,
				status: "Cancelled",
			},
			{
				summary: "Pilot standup",
				startAt: "2026-11-09T08:00:00Z",
				allDay: false,
				status: "Confirmed",
			},
		]);

		const stored = await store.transaction((repos) =>
			repos.calendarCollection.get(ACCOUNT_CONFIG_ID, collection.calendarId),
		);
		assert.equal(stored.subscriptionCheckedAt, 5_000);
		assert.equal(stored.subscriptionFetchedAt, 5_000);
		assert.equal(stored.subscriptionError, "");
	});

	it("leaves unchanged events alone and removes what the feed dropped", async () => {
		const { store, collection } = await subscribed();
		await writeFeed(store, collection, GOOGLE_FEED, 5_000);
		const sequenceBefore = (
			await store.transaction((repos) =>
				repos.calendarCollection.get(ACCOUNT_CONFIG_ID, collection.calendarId),
			)
		).syncSequence;

		const dropped = GOOGLE_FEED.replace(
			/BEGIN:VEVENT\r\nDTSTART:20261008T140000Z[\s\S]*?END:VEVENT\r\n/,
			"",
		);
		const write = await writeFeed(store, collection, dropped, 9_000);

		assert.deepEqual(write, {
			paused: false,
			written: 0,
			unchanged: 2,
			removed: 1,
			skipped: 0,
		});
		const summaries = (await drawn(store, collection)).map(
			(instance) => instance.summary,
		);
		assert.equal(summaries.includes("Tide table review"), false);
		assert.equal(summaries.length, 6);
		const after = await store.transaction((repos) =>
			repos.calendarCollection.get(ACCOUNT_CONFIG_ID, collection.calendarId),
		);
		assert.equal(after.syncSequence, sequenceBefore + 1);
	});

	it("writes nothing when a second fetch differs only in its export stamps", async () => {
		const { store, collection } = await subscribed();
		await writeFeed(store, collection, GOOGLE_FEED, 5_000);
		const before = await store.transaction((repos) =>
			repos.calendarCollection.get(ACCOUNT_CONFIG_ID, collection.calendarId),
		);

		const restamped = GOOGLE_FEED.replaceAll(
			"DTSTAMP:20260925T120000Z",
			"DTSTAMP:20260926T081500Z",
		);
		const write = await writeFeed(store, collection, restamped, 9_000);

		assert.deepEqual(write, {
			paused: false,
			written: 0,
			unchanged: 3,
			removed: 0,
			skipped: 0,
		});
		const after = await store.transaction((repos) =>
			repos.calendarCollection.get(ACCOUNT_CONFIG_ID, collection.calendarId),
		);
		assert.equal(after.syncSequence, before.syncSequence);
		assert.equal(after.subscriptionFetchedAt, 9_000);
	});

	it("writes nothing for a subscription paused while its feed was read", async () => {
		const { store, collection } = await subscribed();
		await store.transaction((repos) =>
			repos.calendarCollection.update(
				ACCOUNT_CONFIG_ID,
				collection.calendarId,
				{ subscriptionEnabled: false },
			),
		);

		const write = await writeFeed(store, collection, GOOGLE_FEED, 5_000);

		assert.deepEqual(write, {
			paused: true,
			written: 0,
			unchanged: 0,
			removed: 0,
			skipped: 0,
		});
		assert.deepEqual(await drawn(store, collection), []);
		const stored = await store.transaction((repos) =>
			repos.calendarCollection.get(ACCOUNT_CONFIG_ID, collection.calendarId),
		);
		assert.equal(stored.subscriptionFetchedAt, 0);
	});

	it("records the events it could not store and keeps the rest", async () => {
		const { store, collection } = await subscribed();

		const write = await writeFeed(
			store,
			collection,
			ical(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"PRODID:-//Example//Feed//EN",
				"BEGIN:VEVENT",
				"UID:kept@example.com",
				"DTSTART:20261008T140000Z",
				"DTEND:20261008T150000Z",
				"SUMMARY:Kept",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"UID:backwards@example.com",
				"DTSTART:20261008T140000Z",
				"DTEND:20261008T130000Z",
				"SUMMARY:Backwards",
				"END:VEVENT",
				"BEGIN:VEVENT",
				"DTSTART:20261009T140000Z",
				"SUMMARY:No UID",
				"END:VEVENT",
				"END:VCALENDAR",
			),
			7_000,
		);

		assert.equal(write.written, 1);
		assert.equal(write.skipped, 2);
		const stored = await store.transaction((repos) =>
			repos.calendarCollection.get(ACCOUNT_CONFIG_ID, collection.calendarId),
		);
		assert.equal(
			stored.subscriptionError,
			"2 events in the feed could not be stored",
		);
		assert.deepEqual(
			(await drawn(store, collection)).map((instance) => instance.summary),
			["Kept"],
		);
	});
});

describe("refreshCalendarSubscription", () => {
	it("records a failed fetch on the collection and keeps every event", async () => {
		const { store, collection } = await subscribed();
		await writeFeed(store, collection, GOOGLE_FEED, 5_000);

		const refreshed = await refreshCalendarSubscription(
			store,
			collection,
			9_000,
			answering("unavailable", { status: 503 }),
		);

		assert.deepEqual(refreshed, {
			ok: false,
			reason: "the feed answered HTTP 503",
		});
		const stored = await store.transaction((repos) =>
			repos.calendarCollection.get(ACCOUNT_CONFIG_ID, collection.calendarId),
		);
		assert.equal(stored.subscriptionCheckedAt, 9_000);
		assert.equal(stored.subscriptionFetchedAt, 5_000);
		assert.equal(stored.subscriptionError, "the feed answered HTTP 503");
		assert.equal(stored.subscriptionError.includes(SECRET_URL), false);
		assert.equal((await drawn(store, collection)).length, 7);
	});

	it("states that a page which is not a calendar is not one", async () => {
		const { store, collection } = await subscribed();

		const refreshed = await refreshCalendarSubscription(
			store,
			collection,
			9_000,
			answering("<!doctype html><title>Sign in</title>", { status: 200 }),
		);

		assert.equal(refreshed.ok, false);
		if (!refreshed.ok) {
			assert.match(refreshed.reason, /^the feed is not a calendar: /);
		}
	});

	it("fetches the collection's own address and clears an earlier failure", async () => {
		const { store, collection } = await subscribed();
		await refreshCalendarSubscription(
			store,
			collection,
			3_000,
			answering("", { status: 500 }),
		);
		const asked: string[] = [];

		const refreshed = await refreshCalendarSubscription(
			store,
			collection,
			6_000,
			async (url) => {
				asked.push(url);
				return new Response(GOOGLE_FEED, { status: 200 });
			},
		);

		assert.deepEqual(asked, [SECRET_URL]);
		assert.ok(refreshed.ok);
		const stored = await store.transaction((repos) =>
			repos.calendarCollection.get(ACCOUNT_CONFIG_ID, collection.calendarId),
		);
		assert.equal(stored.subscriptionError, "");
		assert.equal(stored.subscriptionFetchedAt, 6_000);
	});
});

describe("isSubscriptionDue", () => {
	it("is due once the last fetch is an interval old, failed or not", async () => {
		const { collection } = await subscribed();
		const checked = { ...collection, subscriptionCheckedAt: 10_000 };

		assert.equal(isSubscriptionDue(checked, 10_000 + 899, 900), false);
		assert.equal(isSubscriptionDue(checked, 10_000 + 900, 900), true);
		assert.equal(isSubscriptionDue(collection, 1, 900), false);
		assert.equal(isSubscriptionDue(collection, 900, 900), true);
	});
});
