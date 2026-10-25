import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { APIGatewayProxyResult } from "aws-lambda";
import type { Context } from "openapi-backend";
import { authenticateSelfHostRequest } from "../jwt-auth.js";
import { normalizeRequest } from "../request.js";
import type { RemitClient } from "../service/data-client.js";
import type { HandlerContext } from "../types.js";
import { CalendarOperations } from "./calendar.js";
import {
	CalendarEventDetailOperations,
	CalendarEventOperations,
	CalendarFreeBusyOperations,
} from "./calendar-event.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";

/**
 * The event, free/busy and window wrappers driven the way an HTTP request
 * drives them — through the registered client — against the SQLite store the
 * self-host build ships (issue #1033).
 */

const listCalendars = CalendarOperations.CalendarOperations_listCalendars;
const createCalendar = CalendarOperations.CalendarOperations_createCalendar;
const listEvents =
	CalendarEventOperations.CalendarEventOperations_listCalendarEvents;
const createEvent =
	CalendarEventOperations.CalendarEventOperations_createCalendarEvent;
const getEvent =
	CalendarEventDetailOperations.CalendarEventDetailOperations_getCalendarEvent;
const updateEvent =
	CalendarEventDetailOperations.CalendarEventDetailOperations_updateCalendarEvent;
const deleteEvent =
	CalendarEventDetailOperations.CalendarEventDetailOperations_deleteCalendarEvent;
const listFreeBusy =
	CalendarFreeBusyOperations.CalendarFreeBusyOperations_listCalendarFreeBusy;

interface Instance {
	calendarId: string;
	calendarObjectId: string;
	recurrenceId: string;
	summary: string;
	start: string;
	end: string;
}

interface Span {
	start: string;
	end: string;
}

const WINDOW = { from: "2026-09-01T00:00:00Z", to: "2026-10-31T00:00:00Z" };

let client: RemitClient;
let cleanup: () => void;
let minted = 0;

const contextOf = (request: {
	params?: Record<string, string>;
	query?: Record<string, unknown>;
	headers?: Record<string, string>;
	requestBody?: unknown;
}): Context => ({ request }) as unknown as Context;

type LambdaEvent = Parameters<typeof normalizeRequest>[0];

const callerOf = (sub: string): HandlerContext => ({
	client,
	identity: {
		kind: "user",
		accountConfigId: deriveAccountConfigId(sub),
		sub,
		email: `${sub}@example.com`,
	},
});

/** A caller nobody else in this file shares a calendar with. */
const anAccount = (): { sub: string; caller: HandlerContext } => {
	minted += 1;
	const sub = `calendar-event-sub-${minted}`;
	return { sub, caller: callerOf(sub) };
};

const defaultCalendarId = async (caller: HandlerContext): Promise<string> => {
	const listed = (await listEvents(
		contextOf({ query: WINDOW }),
		caller,
	)) as unknown as { items: Instance[] };
	assert.ok(Array.isArray(listed.items));
	const [collection] = await client.calendarCollection.listByAccountConfig(
		caller.identity.accountConfigId,
	);
	assert.ok(collection);
	return collection.calendarId;
};

const seedEvent = async (
	caller: HandlerContext,
	input: Record<string, unknown>,
): Promise<{ calendarObjectId: string; etag: string; icalData: string }> => {
	const created = await createEvent(contextOf({ requestBody: input }), caller);
	assert.equal(
		created.statusCode,
		undefined,
		`create was refused: ${JSON.stringify(created)}`,
	);
	return created as unknown as {
		calendarObjectId: string;
		etag: string;
		icalData: string;
	};
};

before(async () => {
	({ client, cleanup } = await createCalendarSqliteClient());
});

after(() => {
	cleanup();
});

describe("an unauthenticated calendar request", () => {
	const routes = [
		{ httpMethod: "GET", path: "/calendars" },
		{ httpMethod: "GET", path: "/calendar-events" },
		{ httpMethod: "POST", path: "/calendar-events" },
		{ httpMethod: "GET", path: "/calendar-free-busy" },
		{ httpMethod: "GET", path: "/calendar-suggestions" },
	];

	for (const route of routes) {
		it(`is answered 401 before ${route.httpMethod} ${route.path} runs`, async () => {
			const refusal = await authenticateSelfHostRequest({
				...route,
				headers: {},
			} as unknown as LambdaEvent);

			assert.equal(refusal?.statusCode, 401);
		});
	}

	it("never serves a calendar to a request carrying no claims", async () => {
		// The gate above is what a browser meets. This is the second lock: a
		// listing reached with no identity is refused before the handler runs,
		// rather than falling back to somebody's account.
		const { api } = await import("../index.js");
		const event = {
			httpMethod: "GET",
			path: "/calendar-events",
			queryStringParameters: WINDOW,
			headers: {},
			body: null,
			requestContext: {},
		} as unknown as LambdaEvent;

		const response = (await api.handleRequest(
			normalizeRequest(event),
			event,
		)) as APIGatewayProxyResult;

		assert.equal(response.statusCode, 401);
	});
});

describe("GET /calendar-events", () => {
	it("covers every collection the caller holds when it names none", async () => {
		const { caller } = anAccount();
		const defaultId = await defaultCalendarId(caller);
		const work = (await createCalendar(
			contextOf({ requestBody: { urlSegment: "work", displayName: "Work" } }),
			caller,
		)) as unknown as { calendarId: string };
		await seedEvent(caller, {
			calendarId: defaultId,
			summary: "Dentist",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T10:00:00Z",
		});
		await seedEvent(caller, {
			calendarId: work.calendarId,
			summary: "Stand-up",
			start: "2026-09-08T09:00:00Z",
			end: "2026-09-08T09:15:00Z",
		});

		const listed = (await listEvents(
			contextOf({ query: WINDOW }),
			caller,
		)) as unknown as { items: Instance[] };

		assert.deepEqual(
			listed.items.map((instance) => instance.summary),
			["Dentist", "Stand-up"],
		);
	});

	it("covers only the subset it names", async () => {
		const { caller } = anAccount();
		const defaultId = await defaultCalendarId(caller);
		const work = (await createCalendar(
			contextOf({ requestBody: { urlSegment: "work", displayName: "Work" } }),
			caller,
		)) as unknown as { calendarId: string };
		await seedEvent(caller, {
			calendarId: defaultId,
			summary: "Dentist",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T10:00:00Z",
		});
		await seedEvent(caller, {
			calendarId: work.calendarId,
			summary: "Stand-up",
			start: "2026-09-08T09:00:00Z",
			end: "2026-09-08T09:15:00Z",
		});

		const listed = (await listEvents(
			contextOf({ query: { ...WINDOW, calendarId: [work.calendarId] } }),
			caller,
		)) as unknown as { items: Instance[] };

		assert.deepEqual(
			listed.items.map((instance) => instance.summary),
			["Stand-up"],
		);
	});

	it("answers not-found for a collection on another account rather than an empty day", async () => {
		// An empty list here would read as "you have nothing on", which is the one
		// answer a clash check must never get wrong.
		const stranger = anAccount();
		const strangersCalendarId = await defaultCalendarId(stranger.caller);
		const { caller } = anAccount();

		const listed = await listEvents(
			contextOf({ query: { ...WINDOW, calendarId: [strangersCalendarId] } }),
			caller,
		);

		assert.equal(listed.statusCode, 404);
		assert.equal((listed.body as { code: string }).code, "not_found");
	});

	it("refuses a window that runs backwards or covers more than a year", async () => {
		const { caller } = anAccount();

		const backwards = await listEvents(
			contextOf({
				query: { from: "2026-09-08T00:00:00Z", to: "2026-09-07T00:00:00Z" },
			}),
			caller,
		);
		const tooWide = await listEvents(
			contextOf({
				query: { from: "2026-01-01T00:00:00Z", to: "2027-06-01T00:00:00Z" },
			}),
			caller,
		);

		assert.equal(backwards.statusCode, 400);
		assert.equal((backwards.body as { code: string }).code, "invalid_window");
		assert.equal(tooWide.statusCode, 400);
	});
});

describe("GET /calendar-events?calendarObjectId", () => {
	it("lists the occurrences of that one resource, across the caller's calendars", async () => {
		const { caller } = anAccount();
		const defaultId = await defaultCalendarId(caller);
		const work = (await createCalendar(
			contextOf({ requestBody: { urlSegment: "work", displayName: "Work" } }),
			caller,
		)) as unknown as { calendarId: string };
		const series = await seedEvent(caller, {
			calendarId: work.calendarId,
			summary: "Stand-up",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T09:15:00Z",
			recurrenceRule: "FREQ=WEEKLY;COUNT=3",
		});
		await seedEvent(caller, {
			calendarId: defaultId,
			summary: "Dentist",
			start: "2026-09-08T09:00:00Z",
			end: "2026-09-08T10:00:00Z",
		});

		const listed = (await listEvents(
			contextOf({
				query: { ...WINDOW, calendarObjectId: series.calendarObjectId },
			}),
			caller,
		)) as unknown as { items: Instance[] };

		assert.deepEqual(
			listed.items.map((instance) => [
				instance.calendarId,
				instance.start.slice(0, 10),
			]),
			[
				[work.calendarId, "2026-09-07"],
				[work.calendarId, "2026-09-14"],
				[work.calendarId, "2026-09-21"],
			],
		);
	});

	it("lists nothing for a resource on another account", async () => {
		const stranger = anAccount();
		const theirs = await seedEvent(stranger.caller, {
			calendarId: await defaultCalendarId(stranger.caller),
			summary: "Private",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T10:00:00Z",
		});
		const { caller } = anAccount();

		const listed = (await listEvents(
			contextOf({
				query: { ...WINDOW, calendarObjectId: theirs.calendarObjectId },
			}),
			caller,
		)) as unknown as { items: Instance[] };

		assert.deepEqual(listed.items, []);
	});
});

describe("GET /calendar-events/{calendarObjectId} without a calendar", () => {
	it("finds the resource among the caller's calendars", async () => {
		const { caller } = anAccount();
		await defaultCalendarId(caller);
		const work = (await createCalendar(
			contextOf({ requestBody: { urlSegment: "work", displayName: "Work" } }),
			caller,
		)) as unknown as { calendarId: string };
		const seeded = await seedEvent(caller, {
			calendarId: work.calendarId,
			summary: "Stand-up",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T09:15:00Z",
		});

		const found = (await getEvent(
			contextOf({
				params: { calendarObjectId: seeded.calendarObjectId },
				query: {},
			}),
			caller,
		)) as unknown as { calendarId: string; dtStart: string };

		assert.equal(found.calendarId, work.calendarId);
		assert.match(found.dtStart, /^2026-09-07/);
	});

	it("answers not-found for a resource on another account", async () => {
		const stranger = anAccount();
		const theirs = await seedEvent(stranger.caller, {
			calendarId: await defaultCalendarId(stranger.caller),
			summary: "Private",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T10:00:00Z",
		});
		const { caller } = anAccount();

		const found = await getEvent(
			contextOf({
				params: { calendarObjectId: theirs.calendarObjectId },
				query: {},
			}),
			caller,
		);

		assert.equal(found.statusCode, 404);
	});
});

describe("POST /calendar-events", () => {
	it("refuses a recurrence rule it cannot read and writes nothing", async () => {
		const { caller } = anAccount();
		const calendarId = await defaultCalendarId(caller);

		const created = await createEvent(
			contextOf({
				requestBody: {
					calendarId,
					summary: "Every other Tuesday",
					start: "2026-09-07T09:00:00Z",
					end: "2026-09-07T10:00:00Z",
					recurrenceRule: "every other tuesday",
				},
			}),
			caller,
		);

		assert.equal(created.statusCode, 400);
		assert.equal(
			(created.body as { code: string }).code,
			"invalid_recurrence_rule",
		);
		assert.deepEqual(
			await client.calendarObject.listByCalendar(calendarId),
			[],
			"the refused create left the calendar empty",
		);
	});

	it("refuses a time zone this server cannot resolve", async () => {
		// A Windows zone name is what a client that has not normalised its input
		// sends. Storing it would draw the event hours from where it belongs.
		const { caller } = anAccount();
		const calendarId = await defaultCalendarId(caller);

		const created = await createEvent(
			contextOf({
				requestBody: {
					calendarId,
					summary: "Review",
					start: "2026-09-07T09:00:00+02:00",
					end: "2026-09-07T10:00:00+02:00",
					timeZone: "Pacific Standard Time",
				},
			}),
			caller,
		);

		assert.equal(created.statusCode, 400);
		assert.equal((created.body as { code: string }).code, "unknown_time_zone");
		assert.deepEqual(
			await client.calendarObject.listByCalendar(calendarId),
			[],
		);
	});
});

describe("PATCH /calendar-events/{calendarObjectId}?scope=This", () => {
	it("writes a RECURRENCE-ID override and leaves the rest of the series alone", async () => {
		const { caller } = anAccount();
		const calendarId = await defaultCalendarId(caller);
		const created = await seedEvent(caller, {
			calendarId,
			summary: "Stand-up",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T09:15:00Z",
			recurrenceRule: "FREQ=WEEKLY;COUNT=5",
		});

		const updated = await updateEvent(
			contextOf({
				params: { calendarObjectId: created.calendarObjectId },
				query: {
					calendarId,
					scope: "This",
					recurrenceId: "2026-09-21T09:00:00Z",
				},
				requestBody: { summary: "Stand-up (in the big room)" },
			}),
			caller,
		);

		assert.equal(
			updated.statusCode,
			undefined,
			`the scoped update was refused: ${JSON.stringify(updated)}`,
		);
		assert.match(
			String(updated.icalData),
			/RECURRENCE-ID[^\r\n]*:20260921T090000Z/,
			"the resource carries an override for the occurrence that was edited",
		);

		const listed = (await listEvents(
			contextOf({ query: WINDOW }),
			caller,
		)) as unknown as { items: Instance[] };
		const renamed = listed.items.filter(
			(instance) => instance.summary === "Stand-up (in the big room)",
		);
		assert.equal(listed.items.length, 5, "the series still has five drawings");
		assert.deepEqual(
			renamed.map((instance) => instance.start),
			["2026-09-21T09:00:00+00:00"],
			"exactly the named occurrence took the new name",
		);
	});
});

describe("DELETE /calendar-events/{calendarObjectId}", () => {
	it("refuses a delete built on an etag the resource no longer carries", async () => {
		const { caller } = anAccount();
		const calendarId = await defaultCalendarId(caller);
		const created = await seedEvent(caller, {
			calendarId,
			summary: "Stand-up",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T09:15:00Z",
		});
		await updateEvent(
			contextOf({
				params: { calendarObjectId: created.calendarObjectId },
				query: { calendarId },
				requestBody: { summary: "Stand-up (renamed)" },
			}),
			caller,
		);

		const removed = await deleteEvent(
			contextOf({
				params: { calendarObjectId: created.calendarObjectId },
				query: { calendarId },
				headers: { "If-Match": `"${created.etag}"` },
			}),
			caller,
		);

		assert.equal(removed.statusCode, 412);
		assert.equal(
			(removed.body as { code: string }).code,
			"precondition_failed",
		);
		const survivor = await client.calendarObject.find(
			calendarId,
			created.calendarObjectId,
		);
		assert.equal(
			survivor?.summary,
			"Stand-up (renamed)",
			"the refused delete left the other writer's version in place",
		);
	});

	it("lets the delete through once the caller has read the current etag", async () => {
		const { caller } = anAccount();
		const calendarId = await defaultCalendarId(caller);
		const created = await seedEvent(caller, {
			calendarId,
			summary: "Stand-up",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T09:15:00Z",
		});

		const removed = await deleteEvent(
			contextOf({
				params: { calendarObjectId: created.calendarObjectId },
				query: { calendarId },
				headers: { "if-match": `W/"${created.etag}"` },
			}),
			caller,
		);

		assert.equal(removed.statusCode, 204);
		assert.equal(
			await client.calendarObject.find(calendarId, created.calendarObjectId),
			null,
		);
	});
});

describe("GET /calendar-free-busy", () => {
	it("merges overlapping meetings across two collections into one busy stretch", async () => {
		const { caller } = anAccount();
		const defaultId = await defaultCalendarId(caller);
		const work = (await createCalendar(
			contextOf({ requestBody: { urlSegment: "work", displayName: "Work" } }),
			caller,
		)) as unknown as { calendarId: string };
		await seedEvent(caller, {
			calendarId: defaultId,
			summary: "Dentist",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T10:00:00Z",
		});
		await seedEvent(caller, {
			calendarId: work.calendarId,
			summary: "Review",
			start: "2026-09-07T09:30:00Z",
			end: "2026-09-07T11:00:00Z",
		});

		const busy = (await listFreeBusy(
			contextOf({ query: WINDOW }),
			caller,
		)) as unknown as { items: Span[] };

		assert.deepEqual(busy.items, [
			{ start: "2026-09-07T09:00:00+00:00", end: "2026-09-07T11:00:00+00:00" },
		]);
	});

	it("renders every span with an explicit +00:00 offset", async () => {
		// A busy span is an interval on the clock, not a civil date, so it never
		// carries a calendar's local zone — a caller renders it in whichever zone
		// it is drawing.
		const { caller } = anAccount();
		const calendarId = await defaultCalendarId(caller);
		await client.calendarCollection.update(
			caller.identity.accountConfigId,
			calendarId,
			{ timezone: "America/New_York" },
		);
		await seedEvent(caller, {
			calendarId,
			summary: "Dentist",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T10:00:00Z",
		});

		const busy = (await listFreeBusy(
			contextOf({ query: WINDOW }),
			caller,
		)) as unknown as { items: Span[] };

		assert.deepEqual(busy.items, [
			{ start: "2026-09-07T09:00:00+00:00", end: "2026-09-07T10:00:00+00:00" },
		]);
	});

	it("leaves out an event that was never busy time", async () => {
		const { caller } = anAccount();
		const calendarId = await defaultCalendarId(caller);
		await seedEvent(caller, {
			calendarId,
			summary: "Focus block",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T10:00:00Z",
			transparency: "Transparent",
		});
		await seedEvent(caller, {
			calendarId,
			summary: "Cancelled review",
			start: "2026-09-07T11:00:00Z",
			end: "2026-09-07T12:00:00Z",
			status: "Cancelled",
		});

		const busy = (await listFreeBusy(
			contextOf({ query: WINDOW }),
			caller,
		)) as unknown as { items: Span[] };

		assert.deepEqual(busy.items, []);
	});

	it("refuses the same windows the event listing refuses", async () => {
		const { caller } = anAccount();

		const missing = await listFreeBusy(
			contextOf({ query: { from: "2026-09-07T00:00:00Z" } }),
			caller,
		);
		const tooWide = await listFreeBusy(
			contextOf({
				query: { from: "2026-01-01T00:00:00Z", to: "2027-06-01T00:00:00Z" },
			}),
			caller,
		);

		assert.equal(missing.statusCode, 400);
		assert.equal((missing.body as { code: string }).code, "invalid_window");
		assert.equal(tooWide.statusCode, 400);
		assert.equal((tooWide.body as { code: string }).code, "invalid_window");
	});
});

describe("GET /calendars", () => {
	it("provisions the account's default collection on a first read", async () => {
		const { caller } = anAccount();

		const listed = (await listCalendars(contextOf({}), caller)) as unknown as {
			items: Array<{ urlSegment: string; source: string }>;
		};

		assert.deepEqual(
			listed.items.map((item) => item.urlSegment),
			["default"],
		);
		assert.equal(listed.items[0]?.source, "Default");
	});
});
