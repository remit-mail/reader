import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalendarFeedFetcher } from "@remit/calendar-service";
import { MemoryCalendarStore } from "@remit/calendar-service/memory-store";
import type { CalendarCollectionItem } from "@remit/data-ports";
import { CalendarSource } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import { refreshDueCalendarSubscriptions } from "./calendar-subscriptions.js";

const INTERVAL_MS = 15 * 60 * 1000;
const NOW = 1_800_000_000_000;

const FEED = `${[
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//Example//Published Calendar//EN",
	"BEGIN:VEVENT",
	"UID:ferry@calendar.example",
	"DTSTAMP:20260901T000000Z",
	"DTSTART:20260908T070000Z",
	"DTEND:20260908T080000Z",
	"SUMMARY:Ferry crossing",
	"END:VEVENT",
	"END:VCALENDAR",
].join("\r\n")}\r\n`;

const logged = (): { log: Logger; lines: string[] } => {
	const lines: string[] = [];
	const capture = (...args: unknown[]) => {
		lines.push(JSON.stringify(args));
	};
	const log = {
		info: capture,
		warn: capture,
		error: capture,
		debug: capture,
		fatal: capture,
		trace: capture,
		child: () => log,
	} as unknown as Logger;
	return { log, lines };
};

const subscription = async (
	store: MemoryCalendarStore,
	urlSegment: string,
	checkedAt: number,
): Promise<CalendarCollectionItem> => {
	const created = await store.transaction((repos) =>
		repos.calendarCollection.create({
			accountConfigId: "account-config-1",
			urlSegment,
			displayName: urlSegment,
			source: CalendarSource.Subscribed,
			subscriptionUrl: `https://calendar.example/${urlSegment}/private-feedfacecafe.ics`,
			subscriptionEnabled: true,
		}),
	);
	return store.transaction((repos) =>
		repos.calendarCollection.update(
			created.accountConfigId,
			created.calendarId,
			{ subscriptionCheckedAt: checkedAt },
		),
	);
};

const recording =
	(asked: string[], answer: (url: string) => Response): CalendarFeedFetcher =>
	async (url) => {
		asked.push(url);
		return answer(url);
	};

describe("refreshDueCalendarSubscriptions", () => {
	it("fetches the subscriptions that are due and skips the rest", async () => {
		const store = new MemoryCalendarStore();
		const due = await subscription(store, "due", NOW - INTERVAL_MS);
		await subscription(store, "fresh", NOW - 60_000);
		const paused = await subscription(store, "paused", 0);
		await store.transaction((repos) =>
			repos.calendarCollection.update(
				paused.accountConfigId,
				paused.calendarId,
				{ subscriptionEnabled: false },
			),
		);
		const asked: string[] = [];

		const tally = await refreshDueCalendarSubscriptions(
			{
				calendarCollection: {
					listEnabledSubscriptions: () =>
						store.transaction((repos) =>
							repos.calendarCollection.listEnabledSubscriptions(),
						),
				},
				calendarUnitOfWork: store,
				log: logged().log,
				fetcher: recording(asked, () => new Response(FEED, { status: 200 })),
			},
			NOW,
			INTERVAL_MS,
		);

		assert.deepEqual(asked, [due.subscriptionUrl]);
		assert.deepEqual(tally, { refreshed: 1, failed: 0, notDue: 1 });
		const objects = await store.transaction((repos) =>
			repos.calendarObject.listByCalendar(due.calendarId),
		);
		assert.deepEqual(
			objects.map((object) => object.summary),
			["Ferry crossing"],
		);
	});

	it("counts a feed that fails, keeps refreshing the others, and never logs an address", async () => {
		const store = new MemoryCalendarStore();
		const broken = await subscription(store, "broken", 0);
		const working = await subscription(store, "working", 0);
		const { log, lines } = logged();

		const tally = await refreshDueCalendarSubscriptions(
			{
				calendarCollection: {
					listEnabledSubscriptions: () =>
						store.transaction((repos) =>
							repos.calendarCollection.listEnabledSubscriptions(),
						),
				},
				calendarUnitOfWork: store,
				log,
				fetcher: recording([], (url) =>
					url === broken.subscriptionUrl
						? new Response("gone", { status: 410 })
						: new Response(FEED, { status: 200 }),
				),
			},
			NOW,
			INTERVAL_MS,
		);

		assert.deepEqual(tally, { refreshed: 1, failed: 1, notDue: 0 });
		const stored = await store.transaction((repos) =>
			repos.calendarCollection.get(broken.accountConfigId, broken.calendarId),
		);
		assert.equal(stored.subscriptionError, "the feed answered HTTP 410");
		assert.equal(stored.subscriptionCheckedAt, NOW);
		const refreshed = await store.transaction((repos) =>
			repos.calendarCollection.get(working.accountConfigId, working.calendarId),
		);
		assert.equal(refreshed.subscriptionFetchedAt, NOW);
		assert.ok(lines.some((line) => line.includes(broken.calendarId)));
		assert.equal(
			lines.some((line) => line.includes("private-feedfacecafe")),
			false,
		);
	});
});
