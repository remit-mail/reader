import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import type {
	RemitImapCalendarEventInstance,
	RemitImapCalendarResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { CalendarClash, EventDraft } from "@remit/ui";
import { act, createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import {
	type HttpCall,
	type HttpMock,
	httpError,
	mockFetch,
} from "../../test-support/http";
import {
	type CalendarCollectionOutcome,
	type CalendarCollectionWrites,
	useCalendarCollectionWrites,
} from "./useCalendarCollectionWrites";
import { useCalendars } from "./useCalendars";
import { useDraftClashes } from "./useDraftClashes";

const WORK = "11111111-1111-4111-8111-111111111111";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let writes: CalendarCollectionWrites | undefined;
let clashes: CalendarClash[] | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	writes = undefined;
	clashes = undefined;
});

const calendars: RemitImapCalendarResponse[] = [
	{
		calendarId: WORK,
		accountConfigId: "cfg-1",
		urlSegment: "work",
		displayName: "Work",
		color: "Cal1",
		componentSet: "VeventOnly",
		source: "UserCreated",
		timezone: "",
		syncSequence: 1,
		createdAt: 0,
		updatedAt: 0,
	} as RemitImapCalendarResponse,
];

const instance = (
	over: Partial<RemitImapCalendarEventInstance>,
): RemitImapCalendarEventInstance =>
	({
		calendarId: WORK,
		calendarObjectId: "obj-1",
		recurrenceId: "",
		icalUid: "uid-1",
		summary: "Board prep",
		start: "2026-06-10T10:30:00+00:00",
		end: "2026-06-10T11:00:00+00:00",
		allDay: false,
		status: "Confirmed",
		transparency: "Opaque",
		zoneCertainty: "Explicit",
		etag: "etag-1",
		hasRecurrence: false,
		...over,
	}) as RemitImapCalendarEventInstance;

const draft = (over: Partial<EventDraft>): EventDraft => ({
	title: "Roadmap review",
	date: "2026-06-10",
	endDate: "2026-06-10",
	startTime: "10:00",
	endTime: "11:00",
	allDay: false,
	calendarId: WORK,
	location: "",
	guests: "",
	notes: "",
	repeat: "",
	...over,
});

const settle = async () => {
	await harness?.flush();
	await harness?.wait(20);
	await harness?.flush();
};

const serve = (respond: (call: HttpCall) => unknown) => {
	http = mockFetch((call) =>
		call.path.endsWith("/calendars") && call.method === "GET"
			? { items: calendars }
			: respond(call),
	);
	harness = createDomHarness();
};

function WritesProbe() {
	useCalendars();
	writes = useCalendarCollectionWrites();
	return null;
}

const write = async (
	run: (writes: CalendarCollectionWrites) => Promise<CalendarCollectionOutcome>,
): Promise<CalendarCollectionOutcome> => {
	const held = writes;
	if (!held) throw new Error("the writes are not mounted");
	let outcome: CalendarCollectionOutcome | undefined;
	await act(async () => {
		outcome = await run(held);
	});
	await settle();
	if (!outcome) throw new Error("the write returned nothing");
	return outcome;
};

const listingReads = (): number =>
	(http?.calls ?? []).filter(
		(call) => call.method === "GET" && call.path.endsWith("/calendars"),
	).length;

describe("managing a calendar collection", () => {
	it("creates one and reads the listing back", async () => {
		serve(() => calendars[0]);
		harness?.renderApp(createElement(WritesProbe));
		await settle();
		const before = listingReads();

		const outcome = await write((writes) =>
			writes.createCalendar({ displayName: "Harbour", urlSegment: "harbour" }),
		);

		assert.deepEqual(outcome, { kind: "written" });
		const posted = (http?.calls ?? []).find((call) => call.method === "POST");
		assert.equal(posted?.body?.urlSegment, "harbour");
		assert.ok(listingReads() > before, "the listing has to be read again");
	});

	it("renames and rezones one through a patch", async () => {
		serve(() => calendars[0]);
		harness?.renderApp(createElement(WritesProbe));
		await settle();

		await write((writes) =>
			writes.updateCalendar(WORK, {
				displayName: "Works",
				timezone: "Europe/Lisbon",
			}),
		);

		const patched = (http?.calls ?? []).find((call) => call.method === "PATCH");
		assert.equal(patched?.path.endsWith(`/calendars/${WORK}`), true);
		assert.equal(patched?.body?.timezone, "Europe/Lisbon");
	});

	it("hands back the server's words when it refuses a delete", async () => {
		serve((call) =>
			call.method === "DELETE"
				? httpError(400, '"default" cannot be removed')
				: calendars[0],
		);
		harness?.renderApp(createElement(WritesProbe));
		await settle();

		const outcome = await write((writes) => writes.deleteCalendar(WORK));
		assert.equal(outcome.kind, "refused");
		assert.match(
			outcome.kind === "refused" ? outcome.message : "",
			/cannot be removed/,
		);
	});
});

function ClashProbe({
	of,
	editing = "",
}: {
	of: EventDraft;
	editing?: string;
}) {
	clashes = useDraftClashes(of, editing);
	return null;
}

const clashesFor = async (
	of: EventDraft,
	items: RemitImapCalendarEventInstance[],
	editing = "",
): Promise<CalendarClash[] | undefined> => {
	serve(() => ({ items }));
	harness?.renderApp(createElement(ClashProbe, { of, editing }));
	await settle();
	return clashes;
};

describe("the clashes a draft runs into", () => {
	const runner = process.env.TZ;
	before(() => {
		process.env.TZ = "UTC";
	});
	after(() => {
		if (runner === undefined) Reflect.deleteProperty(process.env, "TZ");
		else process.env.TZ = runner;
	});

	it("reads the draft on the device's clock, not the calendar's", async () => {
		process.env.TZ = "Europe/Amsterdam";
		try {
			const found = await clashesFor(
				draft({ startTime: "12:00", endTime: "13:00" }),
				[instance({})],
			);
			assert.equal(found?.length, 1);
		} finally {
			process.env.TZ = "UTC";
		}
	});

	it("names an event the span overlaps", async () => {
		const found = await clashesFor(draft({}), [instance({})]);
		assert.equal(found?.length, 1);
		assert.match(found?.[0]?.label ?? "", /^Board prep, /);
	});

	it("finds none for a span in a free slot", async () => {
		const found = await clashesFor(
			draft({ startTime: "14:00", endTime: "15:00" }),
			[instance({})],
		);
		assert.deepEqual(found, []);
	});

	it("never counts the event being edited against itself", async () => {
		const found = await clashesFor(draft({}), [instance({})], "obj-1");
		assert.deepEqual(found, []);
	});

	it("checks a multi-day span through its last day", async () => {
		const found = await clashesFor(
			draft({
				endDate: "2026-06-16",
				startTime: "09:00",
				endTime: "17:00",
			}),
			[
				instance({
					start: "2026-06-15T12:00:00+00:00",
					end: "2026-06-15T13:00:00+00:00",
				}),
			],
		);
		assert.equal(found?.length, 1);
		const read = http?.to("/calendar-events")[0]?.url ?? "";
		assert.ok(
			read.includes(`to=${encodeURIComponent("2026-06-22")}`),
			"the read has to cover the week of the last day",
		);
	});

	it("checks nothing when the end is not after the start", async () => {
		const found = await clashesFor(
			draft({ startTime: "10:00", endTime: "10:00" }),
			[instance({})],
		);
		assert.equal(found, undefined);
	});

	it("checks nothing for an all-day draft", async () => {
		const found = await clashesFor(draft({ allDay: true }), [instance({})]);
		assert.equal(found, undefined);
	});
});
