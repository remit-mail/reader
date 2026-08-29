/**
 * What the calendar asks the server, and how often.
 *
 * Three things are pinned here, and all three are about the request rather than
 * about the pixels: the window is the screenful the address names, the same
 * week asked for twice is one request, and a step lands on a window that was
 * already warmed. A grid that refetches on every navigation looks identical in
 * a screenshot and is a different product to use.
 *
 * The tick list is the fourth: ticking nothing is every calendar, and an
 * address naming a calendar that is gone shows the rest rather than a week that
 * reads as empty.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapCalendarEventInstance,
	RemitImapCalendarResponse,
} from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { type CalendarData, useCalendarData } from "@/hooks/useCalendarData";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, mockFetch } from "../../test-support/http";

const WORK = "11111111-1111-4111-8111-111111111111";
const HOME = "22222222-2222-4222-8222-222222222222";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let data: CalendarData | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	data = undefined;
});

const calendar = (
	calendarId: string,
	displayName: string,
): RemitImapCalendarResponse =>
	({
		calendarId,
		accountConfigId: "cfg-1",
		urlSegment: displayName.toLowerCase(),
		displayName,
		color: "Cal1",
		componentSet: "VeventOnly",
		source: "UserCreated",
		timezone: "Europe/Amsterdam",
		syncSequence: 1,
		createdAt: 0,
		updatedAt: 0,
	}) as RemitImapCalendarResponse;

const instance = (
	over: Partial<RemitImapCalendarEventInstance>,
): RemitImapCalendarEventInstance =>
	({
		calendarId: WORK,
		calendarObjectId: "obj-1",
		recurrenceId: "",
		icalUid: "uid-1",
		summary: "Roadmap review",
		start: "2026-06-10T10:00:00+02:00",
		end: "2026-06-10T11:30:00+02:00",
		allDay: false,
		status: "Confirmed",
		transparency: "Opaque",
		zoneCertainty: "Explicit",
		etag: "etag-1",
		hasRecurrence: false,
		...over,
	}) as RemitImapCalendarEventInstance;

function Probe({
	date,
	calendarIds,
}: {
	date: string;
	calendarIds: readonly string[];
}) {
	data = useCalendarData({ view: "week", date, calendarIds });
	return null;
}

const mount = async (
	date: string,
	calendarIds: readonly string[],
	instances: RemitImapCalendarEventInstance[] = [],
	calendars: RemitImapCalendarResponse[] = [
		calendar(WORK, "Work"),
		calendar(HOME, "Home"),
	],
) => {
	http = mockFetch((call) =>
		call.path.endsWith("/calendars")
			? { items: calendars }
			: { items: instances },
	);
	harness = createDomHarness();
	harness.renderApp(createElement(Probe, { date, calendarIds }));
	await harness.flush();
	await harness.wait(20);
	await harness.flush();
};

const rerender = async (date: string, calendarIds: readonly string[]) => {
	harness?.renderApp(createElement(Probe, { date, calendarIds }));
	await harness?.flush();
	await harness?.wait(20);
	await harness?.flush();
};

/** Event listings whose window starts on a given day. */
const windowsFrom = (day: string): string[] =>
	(http?.to("/calendar-events") ?? [])
		.map((call) => call.url)
		.filter((url) => url.includes(`from=${encodeURIComponent(day)}`));

describe("the window the grid asks for", () => {
	it("is the week the address names, not the day", async () => {
		await mount("2026-06-10", []);
		const asked = windowsFrom("2026-06-08");
		assert.equal(asked.length, 1, "the visible week was asked for once");
		assert.ok(
			asked[0].includes(`to=${encodeURIComponent("2026-06-15")}`),
			`the window ends on the next Monday: ${asked[0]}`,
		);
	});

	it("warms the week either side, so a step is not a wait", async () => {
		await mount("2026-06-10", []);
		assert.equal(windowsFrom("2026-06-01").length, 1);
		assert.equal(windowsFrom("2026-06-15").length, 1);
	});
});

describe("moving around inside a week already read", () => {
	it("asks nothing again", async () => {
		await mount("2026-06-08", []);
		await rerender("2026-06-11", []);
		assert.equal(
			windowsFrom("2026-06-08").length,
			1,
			"every day of one week shares the window that was already fetched",
		);
	});

	it("steps onto a week the prefetch already holds", async () => {
		await mount("2026-06-10", []);
		const before = windowsFrom("2026-06-15").length;
		await rerender("2026-06-17", []);
		assert.equal(
			windowsFrom("2026-06-15").length,
			before,
			"the next week was warmed, so stepping onto it fetches nothing",
		);
	});
});

describe("the calendars the address ticked", () => {
	it("names none when the reader has ticked none", async () => {
		await mount("2026-06-10", []);
		assert.ok(
			windowsFrom("2026-06-08").every((url) => !url.includes("calendarId=")),
			"ticking nothing off is every calendar, which the API takes as no filter",
		);
	});

	it("names the one the address ticked", async () => {
		await mount("2026-06-10", [WORK]);
		const asked = windowsFrom("2026-06-08");
		assert.equal(asked.length, 1);
		assert.ok(asked[0].includes(`calendarId=${WORK}`));
		assert.ok(!asked[0].includes(`calendarId=${HOME}`));
	});

	it("shows the rest when the address names a calendar that is gone", async () => {
		await mount("2026-06-10", ["33333333-3333-4333-8333-333333333333"]);
		assert.ok(
			windowsFrom("2026-06-08").every((url) => !url.includes("calendarId=")),
			"an address pointing at nothing shows the calendar, not an empty week",
		);
	});
});

/**
 * The zone every write is built in, so it has to be one the server will take.
 *
 * The server checks a TZID against `Intl.supportedValuesOf("timeZone")` — the
 * canonical IANA list, which holds no spelling of UTC at all — and refuses
 * anything absent from it. A collection naming no zone therefore cannot be
 * answered with a substitute, and above all not with the reader's own: a
 * browser on a UTC machine resolves that to "UTC", and every event written
 * from one was refused for a zone nobody had chosen.
 */
describe("the zone a collection is read on", () => {
	const RESOLVABLE = new Set(Intl.supportedValuesOf("timeZone"));

	it("is one the server will take, or none at all", async () => {
		await mount(
			"2026-06-10",
			[],
			[],
			[
				{
					...calendar(WORK, "Work"),
					timezone: "",
				} as RemitImapCalendarResponse,
			],
		);
		const zone = data?.timeZoneByCalendarId[WORK];
		assert.ok(
			zone === "" || RESOLVABLE.has(zone ?? ""),
			`"${zone}" is neither absent nor a zone the server accepts as a TZID`,
		);
	});

	it("is the collection's own where it has one", async () => {
		await mount("2026-06-10", []);
		assert.equal(data?.timeZoneByCalendarId[WORK], "Europe/Amsterdam");
	});
});

describe("what the grid is handed", () => {
	it("draws the occurrences the server expanded", async () => {
		await mount(
			"2026-06-10",
			[],
			[
				instance({ calendarObjectId: "obj-1" }),
				instance({
					calendarObjectId: "obj-2",
					recurrenceId: "2026-06-11T07:15:00Z",
					summary: "Standup",
					hasRecurrence: true,
				}),
			],
		);
		assert.deepEqual(
			data?.events.map((event) => event.id),
			["obj-1", "obj-2#2026-06-11T07:15:00Z"],
		);
		assert.equal(data?.events[1].title, "Standup");
	});

	it("leaves a cancelled occurrence off rather than drawing it as confirmed", async () => {
		await mount(
			"2026-06-10",
			[],
			[
				instance({ calendarObjectId: "obj-1" }),
				instance({ calendarObjectId: "obj-3", status: "Cancelled" }),
			],
		);
		assert.deepEqual(
			data?.events.map((event) => event.id),
			["obj-1"],
		);
	});
});
