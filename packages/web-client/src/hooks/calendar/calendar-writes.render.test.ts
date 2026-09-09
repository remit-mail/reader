/**
 * Writing an event, and what the calendar does with the answer.
 *
 * Three outcomes have to be distinguishable at the call site, which is why they
 * are returned rather than thrown: the write landed, somebody else had already
 * written it, or the server refused it. The one that must never be silent is
 * the middle one — a 412 says the version on screen is stale, and applying the
 * edit anyway would discard a change nobody would ever see go.
 *
 * A lapsed session is not one of the three. It escalates to the page that signs
 * the reader back in, so the caches here are the real ones from
 * `lib/query-error-handler.ts` rather than the harness's quiet default.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapCalendarResponse } from "@remit/api-http-client/types.gen.ts";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { act, createElement, Fragment } from "react";
import { FatalErrorOverlay } from "@/components/ui/FatalErrorOverlay";
import { useCalendarData } from "@/hooks/useCalendarData";
import { __resetFatalError } from "@/lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "@/lib/query-error-handler";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import {
	type HttpCall,
	type HttpMock,
	httpError,
	mockFetch,
} from "../../test-support/http";
import {
	type CalendarWriteOutcome,
	type CalendarWrites,
	useCalendarWrites,
} from "./useCalendarWrites";

const WORK = "11111111-1111-4111-8111-111111111111";
const OBJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let writes: CalendarWrites | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	writes = undefined;
	__resetFatalError();
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
		timezone: "Europe/Amsterdam",
		syncSequence: 1,
		createdAt: 0,
		updatedAt: 0,
	} as RemitImapCalendarResponse,
];

const escalatingClient = (): QueryClient =>
	new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

/** Reads the visible week and holds the writes, the way the routes do. */
function Probe() {
	useCalendarData({ view: "week", date: "2026-06-10", calendarIds: [] });
	writes = useCalendarWrites();
	return null;
}

const mount = async (
	respond: (call: HttpCall) => unknown,
	options: { escalating?: boolean; calendarsRespond?: boolean } = {},
) => {
	const serveCalendars = options.calendarsRespond ?? true;
	http = mockFetch((call) =>
		serveCalendars && call.path.endsWith("/calendars") && call.method === "GET"
			? { items: calendars }
			: respond(call),
	);
	harness = createDomHarness(
		options.escalating ? { queryClient: escalatingClient() } : {},
	);
	harness.renderApp(
		createElement(
			Fragment,
			null,
			createElement(FatalErrorOverlay),
			createElement(Probe),
		),
	);
	await settle();
};

const settle = async () => {
	await harness?.flush();
	await harness?.wait(20);
	await harness?.flush();
};

/** The writes the probe is holding, driven inside `act` the way a click is. */
const write = async (
	run: (writes: CalendarWrites) => Promise<CalendarWriteOutcome>,
): Promise<CalendarWriteOutcome> => {
	const held = writes;
	if (!held) throw new Error("the writes are not mounted");
	let outcome: CalendarWriteOutcome | undefined;
	await act(async () => {
		outcome = await run(held);
	});
	await settle();
	if (!outcome) throw new Error("the write returned nothing");
	return outcome;
};

const listings = (): number =>
	(http?.to("/calendar-events") ?? []).filter(
		(call) =>
			call.method === "GET" &&
			call.url.includes(`from=${encodeURIComponent("2026-06-08")}`),
	).length;

const scopedWrite = {
	calendarObjectId: OBJECT,
	calendarId: WORK,
	recurrenceId: "2026-06-11T07:15:00Z",
	scope: "this" as const,
	etag: "etag-1",
};

describe("creating an event", () => {
	it("posts it and reads the week back, so the grid shows it", async () => {
		await mount(() => ({ items: [] }));
		const before = listings();

		const outcome = await write((writes) =>
			writes.createEvent({
				calendarId: WORK,
				summary: "Roadmap review",
				start: "2026-06-10T10:00:00+02:00",
				end: "2026-06-10T11:30:00+02:00",
			}),
		);

		assert.deepEqual(outcome, { kind: "written" });
		const posted = (http?.to("/calendar-events") ?? []).filter(
			(call) => call.method === "POST",
		);
		assert.equal(posted.length, 1);
		assert.equal(posted[0].body?.summary, "Roadmap review");
		assert.ok(
			listings() > before,
			"the window a write changed has to be read again",
		);
	});
});

describe("editing one occurrence of a series", () => {
	it("names the occurrence, the scope, and the version it was built on", async () => {
		await mount(() => ({ items: [] }));
		await write((writes) =>
			writes.updateEvent(scopedWrite, { summary: "Standup" }),
		);

		const patched = (http?.calls ?? []).find((call) => call.method === "PATCH");
		assert.ok(patched, "the edit was sent");
		assert.equal(
			patched.headers["if-match"],
			"etag-1",
			"an unconditional write is one that can discard somebody else's edit",
		);
		assert.ok(patched.url.includes("scope=This"), patched.url);
		assert.ok(
			patched.url.includes(encodeURIComponent("2026-06-11T07:15:00Z")),
			patched.url,
		);
	});

	it("makes the delete conditional on the same version", async () => {
		await mount(() => ({ items: [] }));
		await write((writes) => writes.deleteEvent(scopedWrite));
		const deleted = (http?.calls ?? []).find(
			(call) => call.method === "DELETE",
		);
		assert.equal(
			deleted?.headers["if-match"],
			"etag-1",
			"an unconditional delete removes whatever is there now, not what was read",
		);
	});
});

describe("a version somebody else has already replaced", () => {
	it("comes back as a conflict rather than as a write that won", async () => {
		await mount((call) =>
			call.method === "PATCH" ? httpError(412, "etag mismatch") : { items: [] },
		);
		const outcome = await write((writes) =>
			writes.updateEvent(scopedWrite, { summary: "Standup" }),
		);
		assert.deepEqual(outcome, { kind: "conflict" });
	});

	it("refuses the delete the same way", async () => {
		await mount((call) =>
			call.method === "DELETE"
				? httpError(412, "etag mismatch")
				: { items: [] },
		);
		const outcome = await write((writes) => writes.deleteEvent(scopedWrite));
		assert.deepEqual(outcome, { kind: "conflict" });
	});
});

describe("a refusal the server states", () => {
	it("comes back with what it said, for the form to show", async () => {
		await mount((call) =>
			call.method === "POST"
				? httpError(400, "start must be before end")
				: { items: [] },
		);
		const outcome = await write((writes) =>
			writes.createEvent({
				calendarId: WORK,
				summary: "Backwards",
				start: "2026-06-10T11:00:00+02:00",
				end: "2026-06-10T10:00:00+02:00",
			}),
		);
		assert.deepEqual(outcome, {
			kind: "refused",
			message: "start must be before end",
		});
	});
});

describe("a session that has lapsed", () => {
	/**
	 * The read is the dangerous one. A calendar that answers a 401 with no
	 * events draws a clear week, and a clear week is what a reader plans around
	 * — they never learn their session ended, and neither does the app.
	 */
	it("never lets the event listing come back as an empty week", async () => {
		await mount(
			(call) =>
				call.method === "GET"
					? httpError(401, "session expired")
					: { items: [] },
			{ escalating: true, calendarsRespond: false },
		);
		assert.ok(
			harness?.query('[data-testid="fatal-error-overlay"]'),
			"a refused read must not be drawn as a week with nothing in it",
		);
	});

	it("escalates a refused calendar list rather than showing no calendars", async () => {
		await mount(
			(call) =>
				call.path.endsWith("/calendars")
					? httpError(401, "session expired")
					: { items: [] },
			{ escalating: true, calendarsRespond: false },
		);
		assert.ok(harness?.query('[data-testid="fatal-error-overlay"]'));
	});

	it("takes the reader to the page that signs them back in", async () => {
		await mount(
			(call) =>
				call.method === "POST"
					? httpError(401, "session expired")
					: { items: [] },
			{ escalating: true },
		);
		await write((writes) =>
			writes.createEvent({
				calendarId: WORK,
				summary: "Roadmap review",
				start: "2026-06-10T10:00:00+02:00",
				end: "2026-06-10T11:30:00+02:00",
			}),
		);

		assert.ok(
			harness?.query('[data-testid="fatal-error-overlay"]'),
			"no banner on a calendar signs anybody back in",
		);
	});
});
