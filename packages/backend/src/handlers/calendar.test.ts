import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type {
	CalendarCollectionItem,
	CalendarEventIndexItem,
	CalendarObjectItem,
} from "@remit/data-ports";
import { CalendarSource, RecurrenceScope } from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import {
	type CalendarDeps,
	CalendarDetailOperations,
	CalendarOperations,
	calendarDepsOf,
	createCalendarFor,
	deleteCalendarFor,
	listCalendarsFor,
	readCollectionTimezone,
	updateCalendarFor,
} from "./calendar.js";
import {
	type CalendarEventDeps,
	createCalendarEventFor,
	deleteCalendarEventFor,
	etagMatches,
	pickEventUpdate,
	readScope,
	readWindow,
	updateCalendarEventFor,
} from "./calendar-event.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";

/**
 * The calendar handlers against the store the self-host build ships.
 *
 * This file used to run on a set of in-memory port implementations that claimed
 * to behave exactly as sqlite. Nothing checked the claim, so it was worth
 * nothing: `putCalendarObject` projects, expands and bumps the sequence, and a
 * memory twin of that is a second implementation of the write path that can
 * drift from the real one silently. Every test here now writes through the
 * drizzle repositories, so the projection, the expansion and the transaction
 * are the shipped ones.
 *
 * One database serves the file. Every calendar row is scoped by account config
 * and `calendarId` is derived from it, so a test that mints its own account
 * sees only what it wrote.
 */

let client: RemitClient;
let cleanup: () => void;
let mintedAccounts = 0;

/** One caller's calendars, and the two ways the handlers reach them. */
class CalendarAccount {
	readonly accountConfigId: string;

	constructor(readonly sub: string) {
		this.accountConfigId = deriveAccountConfigId(sub);
	}

	/** The request an authenticated caller of this account arrives on. */
	request(): APIGatewayProxyEvent {
		return {
			requestContext: { authorizer: { claims: { sub: this.sub } } },
		} as unknown as APIGatewayProxyEvent;
	}

	deps(): CalendarDeps {
		return calendarDepsOf(client);
	}

	/** The same deps with id minting and the clock pinned. */
	eventDeps(): CalendarEventDeps {
		let minted = 0;
		return {
			...this.deps(),
			newId: () => {
				minted += 1;
				return `${this.accountConfigId}-minted-${minted}`;
			},
			now: () => new Date("2026-08-29T00:00:00Z"),
		};
	}

	collections(): Promise<CalendarCollectionItem[]> {
		return client.calendarCollection.listByAccountConfig(this.accountConfigId);
	}

	async collection(calendarId: string): Promise<CalendarCollectionItem | null> {
		const held = await this.collections();
		return (
			held.find((collection) => collection.calendarId === calendarId) ?? null
		);
	}

	async objects(): Promise<CalendarObjectItem[]> {
		const held = await this.collections();
		const objects: CalendarObjectItem[] = [];
		for (const collection of held) {
			objects.push(
				...(await client.calendarObject.listByCalendar(collection.calendarId)),
			);
		}
		return objects;
	}

	object(
		calendarId: string,
		calendarObjectId: string,
	): Promise<CalendarObjectItem | null> {
		return client.calendarObject.find(calendarId, calendarObjectId);
	}

	occurrences(object: {
		calendarId: string;
		calendarObjectId: string;
	}): Promise<CalendarEventIndexItem[]> {
		return client.calendarEventIndex.listForObject(
			object.calendarId,
			object.calendarObjectId,
		);
	}
}

const anAccount = (): CalendarAccount => {
	mintedAccounts += 1;
	return new CalendarAccount(`calendar-sub-${mintedAccounts}`);
};

const seedWeekly = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	calendarId: string,
	recurrenceRule = "FREQ=WEEKLY;COUNT=5",
) => {
	const created = await createCalendarEventFor(deps, accountConfigId, {
		calendarId,
		summary: "Stand-up",
		start: "2026-09-07T09:00:00Z",
		end: "2026-09-07T10:00:00Z",
		recurrenceRule,
	});
	assert.ok(created.ok, JSON.stringify(created));
	return created.value;
};

before(async () => {
	_resetForTest();
	({ client, cleanup } = await createCalendarSqliteClient());
	setClient(client);
});

after(() => {
	_resetForTest();
	cleanup();
});

describe("listCalendarsFor", () => {
	it("provisions the default calendar on a first read", async () => {
		const account = anAccount();

		const calendars = await listCalendarsFor(
			account.deps(),
			account.accountConfigId,
		);

		assert.equal(calendars.length, 1);
		assert.equal(calendars[0]?.urlSegment, "default");
		assert.equal(calendars[0]?.source, CalendarSource.Default);
	});

	it("provisions it exactly once when several reads arrive together", async () => {
		const account = anAccount();

		const reads = await Promise.all(
			Array.from({ length: 8 }, () =>
				listCalendarsFor(account.deps(), account.accountConfigId),
			),
		);

		assert.equal((await account.collections()).length, 1);
		const ids = new Set(reads.flat().map((calendar) => calendar.calendarId));
		assert.equal(ids.size, 1);
	});
});

describe("createCalendarFor", () => {
	it("refuses a url segment the account already uses", async () => {
		const account = anAccount();
		const deps = account.deps();
		await createCalendarFor(deps, account.accountConfigId, {
			urlSegment: "work",
			displayName: "Work",
		});

		const second = await createCalendarFor(deps, account.accountConfigId, {
			urlSegment: "WORK",
			displayName: "Work again",
		});

		assert.ok(!second.ok);
		assert.equal(second.error.code, "UrlSegmentTaken");
		const held = await account.collections();
		assert.equal(held.length, 1);
		assert.equal(
			held[0]?.displayName,
			"Work",
			"the refused create never wrote over the calendar that holds the segment",
		);
	});

	it("refuses an empty url segment", async () => {
		const account = anAccount();

		const created = await createCalendarFor(
			account.deps(),
			account.accountConfigId,
			{
				urlSegment: "  ",
				displayName: "Nameless",
			},
		);

		assert.ok(!created.ok);
		assert.equal(created.error.code, "InvalidUrlSegment");
	});
});

describe("deleteCalendarFor", () => {
	it("refuses to remove the calendar events fall back to", async () => {
		const account = anAccount();
		const deps = account.deps();
		const [fallback] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(fallback);

		const removed = await deleteCalendarFor(
			deps,
			account.accountConfigId,
			fallback.calendarId,
		);

		assert.ok(!removed.ok);
		assert.equal(removed.error.code, "DefaultCalendarUndeletable");
		assert.equal((await account.collections()).length, 1);
	});

	it("takes the events and their occurrences with a calendar it does remove", async () => {
		const account = anAccount();
		const deps = account.eventDeps();
		const created = await createCalendarFor(deps, account.accountConfigId, {
			urlSegment: "work",
			displayName: "Work",
		});
		assert.ok(created.ok);
		const event = await seedWeekly(
			deps,
			account.accountConfigId,
			created.value.calendarId,
		);
		assert.equal((await account.objects()).length, 1);

		const removed = await deleteCalendarFor(
			deps,
			account.accountConfigId,
			created.value.calendarId,
		);

		assert.ok(removed.ok);
		assert.deepEqual(await account.objects(), []);
		assert.deepEqual(await account.occurrences(event), []);
	});

	it("answers not-found for a calendar on another account", async () => {
		const account = anAccount();
		const deps = account.deps();
		const [mine] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(mine);

		const removed = await deleteCalendarFor(
			deps,
			anAccount().accountConfigId,
			mine.calendarId,
		);

		assert.ok(!removed.ok);
		assert.equal(removed.error.code, "NotFound");
	});
});

describe("readWindow", () => {
	it("refuses a window that is missing, backwards or wider than a year", () => {
		assert.equal(readWindow(undefined, "2026-09-08T00:00:00Z").ok, false);
		assert.equal(readWindow("not a date", "2026-09-08T00:00:00Z").ok, false);
		assert.equal(
			readWindow("2026-09-08T00:00:00Z", "2026-09-07T00:00:00Z").ok,
			false,
		);
		assert.equal(
			readWindow("2026-01-01T00:00:00Z", "2027-06-01T00:00:00Z").ok,
			false,
		);
	});

	it("refuses an end that carries no zone offset", () => {
		const wallTime = readWindow("2026-01-01T00:00:00", "2026-01-08T00:00:00Z");
		assert.ok(!wallTime.ok);
		assert.equal(wallTime.error.code, "InvalidWindow");

		const dateOnly = readWindow("2026-01-01T00:00:00Z", "2026-01-08");
		assert.ok(!dateOnly.ok);
		assert.equal(dateOnly.error.code, "InvalidWindow");
	});

	it("accepts either spelling of an offset", () => {
		assert.equal(
			readWindow("2026-01-01T00:00:00Z", "2026-01-08T00:00:00Z").ok,
			true,
		);
		assert.equal(
			readWindow("2026-01-01T00:00:00+02:00", "2026-01-08T00:00:00+02:00").ok,
			true,
		);
	});

	it("normalises both ends to UTC instants", () => {
		const window = readWindow(
			"2026-09-07T02:00:00+02:00",
			"2026-09-08T02:00:00+02:00",
		);

		assert.ok(window.ok);
		assert.deepEqual(window.value, {
			from: "2026-09-07T00:00:00Z",
			to: "2026-09-08T00:00:00Z",
		});
	});
});

describe("etagMatches", () => {
	it("lets a write through with no precondition, a wildcard or the tag it read", () => {
		assert.equal(etagMatches(undefined, "abc"), true);
		assert.equal(etagMatches("*", "abc"), true);
		assert.equal(etagMatches('"abc"', "abc"), true);
		assert.equal(etagMatches('W/"abc"', "abc"), true);
		assert.equal(etagMatches('"other", "abc"', "abc"), true);
	});

	it("refuses a tag the resource no longer carries", () => {
		assert.equal(etagMatches('"stale"', "abc"), false);
	});
});

describe("pickEventUpdate", () => {
	it("keeps absence, so a rename touches nothing else", () => {
		assert.deepEqual(pickEventUpdate({ summary: "Renamed" }), {
			summary: "Renamed",
		});
	});

	it("drops a field the API does not define", () => {
		assert.deepEqual(
			pickEventUpdate({ summary: "Renamed", icalData: "smuggled" } as never),
			{ summary: "Renamed" },
		);
	});
});

describe("updateCalendarEventFor", () => {
	it("refuses a write built on an etag the resource no longer carries", async () => {
		const account = anAccount();
		const deps = account.eventDeps();
		const [calendar] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(calendar);
		const event = await seedWeekly(
			deps,
			account.accountConfigId,
			calendar.calendarId,
		);

		const first = await updateCalendarEventFor(
			deps,
			account.accountConfigId,
			{
				calendarId: calendar.calendarId,
				calendarObjectId: event.calendarObjectId,
				scope: RecurrenceScope.All,
				recurrenceId: "",
				ifMatch: `"${event.etag}"`,
			},
			{ summary: "Stand-up (renamed)" },
		);
		assert.ok(first.ok);

		const stale = await updateCalendarEventFor(
			deps,
			account.accountConfigId,
			{
				calendarId: calendar.calendarId,
				calendarObjectId: event.calendarObjectId,
				scope: RecurrenceScope.All,
				recurrenceId: "",
				ifMatch: `"${event.etag}"`,
			},
			{ summary: "Stand-up (renamed again)" },
		);

		assert.ok(!stale.ok);
		assert.equal(stale.error.code, "EtagMismatch");
		const survivor = await account.object(
			calendar.calendarId,
			event.calendarObjectId,
		);
		assert.equal(
			survivor?.summary,
			"Stand-up (renamed)",
			"the losing write left the resource alone",
		);
	});

	it("writes both resources of a Following split", async () => {
		const account = anAccount();
		const deps = account.eventDeps();
		const [calendar] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(calendar);
		const event = await seedWeekly(
			deps,
			account.accountConfigId,
			calendar.calendarId,
		);

		const split = await updateCalendarEventFor(
			deps,
			account.accountConfigId,
			{
				calendarId: calendar.calendarId,
				calendarObjectId: event.calendarObjectId,
				scope: RecurrenceScope.Following,
				recurrenceId: "2026-09-21T09:00:00Z",
				ifMatch: undefined,
			},
			{ summary: "Stand-up (new format)" },
		);

		assert.ok(split.ok, JSON.stringify(split));
		const objects = (await account.objects()).sort((left, right) =>
			left.dtStart.localeCompare(right.dtStart),
		);
		assert.equal(objects.length, 2);
		const [head, tail] = objects;
		assert.equal(head?.summary, "Stand-up");
		assert.equal(tail?.summary, "Stand-up (new format)");
		assert.notEqual(head?.icalUid, tail?.icalUid);
		assert.equal(
			split.value?.calendarObjectId,
			tail?.calendarObjectId,
			"the caller is handed the remainder, which is where their edit landed",
		);
		assert.notEqual(split.value?.calendarObjectId, event.calendarObjectId);
	});

	it("answers not-found for an event the calendar does not hold", async () => {
		const account = anAccount();
		const deps = account.eventDeps();
		const [calendar] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(calendar);

		const updated = await updateCalendarEventFor(
			deps,
			account.accountConfigId,
			{
				calendarId: calendar.calendarId,
				calendarObjectId: "absent",
				scope: RecurrenceScope.All,
				recurrenceId: "",
				ifMatch: undefined,
			},
			{ summary: "Renamed" },
		);

		assert.ok(!updated.ok);
		assert.equal(updated.error.code, "NotFound");
	});
});

describe("deleteCalendarEventFor", () => {
	it("removes the resource and its occurrences under scope=All", async () => {
		const account = anAccount();
		const deps = account.eventDeps();
		const [calendar] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(calendar);
		const event = await seedWeekly(
			deps,
			account.accountConfigId,
			calendar.calendarId,
		);

		const removed = await deleteCalendarEventFor(
			deps,
			account.accountConfigId,
			{
				calendarId: calendar.calendarId,
				calendarObjectId: event.calendarObjectId,
				scope: RecurrenceScope.All,
				recurrenceId: "",
				ifMatch: undefined,
			},
		);

		assert.ok(removed.ok);
		assert.deepEqual(await account.objects(), []);
		assert.deepEqual(await account.occurrences(event), []);
	});

	it("keeps the series under scope=This and drops one occurrence from it", async () => {
		const account = anAccount();
		const deps = account.eventDeps();
		const [calendar] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(calendar);
		const event = await seedWeekly(
			deps,
			account.accountConfigId,
			calendar.calendarId,
		);
		assert.equal((await account.occurrences(event)).length, 5);

		const removed = await deleteCalendarEventFor(
			deps,
			account.accountConfigId,
			{
				calendarId: calendar.calendarId,
				calendarObjectId: event.calendarObjectId,
				scope: RecurrenceScope.This,
				recurrenceId: "2026-09-21T09:00:00Z",
				ifMatch: undefined,
			},
		);

		assert.ok(removed.ok);
		assert.equal((await account.objects()).length, 1);
		const rows = await account.occurrences(event);
		assert.equal(rows.length, 4);
		assert.equal(
			rows.some((row) => row.startAt === "2026-09-21T09:00:00Z"),
			false,
		);
	});

	it("refuses a per-occurrence delete of an event that happens once", async () => {
		const account = anAccount();
		const deps = account.eventDeps();
		const [calendar] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(calendar);
		const event = await seedWeekly(
			deps,
			account.accountConfigId,
			calendar.calendarId,
			"",
		);

		const removed = await deleteCalendarEventFor(
			deps,
			account.accountConfigId,
			{
				calendarId: calendar.calendarId,
				calendarObjectId: event.calendarObjectId,
				scope: RecurrenceScope.This,
				recurrenceId: "2026-09-07T09:00:00Z",
				ifMatch: undefined,
			},
		);

		assert.ok(!removed.ok);
		assert.equal(removed.error.code, "NotRecurring");
		assert.equal((await account.objects()).length, 1);
	});
});

describe("createCalendarEventFor", () => {
	it("refuses an event aimed at a calendar the account does not hold", async () => {
		const account = anAccount();
		const deps = account.eventDeps();

		const created = await createCalendarEventFor(
			deps,
			account.accountConfigId,
			{
				calendarId: "someone-elses-calendar",
				summary: "Stand-up",
				start: "2026-09-07T09:00:00Z",
				end: "2026-09-07T10:00:00Z",
			},
		);

		assert.ok(!created.ok);
		assert.equal(created.error.code, "NotFound");
	});

	it("refuses an event that ends before it starts", async () => {
		const account = anAccount();
		const deps = account.eventDeps();
		const [calendar] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(calendar);

		const created = await createCalendarEventFor(
			deps,
			account.accountConfigId,
			{
				calendarId: calendar.calendarId,
				summary: "Backwards",
				start: "2026-09-07T10:00:00Z",
				end: "2026-09-07T09:00:00Z",
			},
		);

		assert.ok(!created.ok);
		assert.equal(created.error.code, "BackwardsEnd");
		assert.deepEqual(await account.objects(), []);
	});
});

describe("readScope", () => {
	it("reads an absent scope as the whole series", () => {
		const scope = readScope(undefined);
		assert.ok(scope.ok);
		assert.equal(scope.value, RecurrenceScope.All);
	});

	it("refuses a scope it does not recognise rather than widening it", () => {
		const scope = readScope("Everything");
		assert.ok(!scope.ok);
		assert.equal(scope.error.code, "InvalidScope");
	});
});

describe("readCollectionTimezone", () => {
	it("accepts an IANA name and an absent one", () => {
		assert.deepEqual(readCollectionTimezone("Europe/Amsterdam"), {
			ok: true,
			value: "Europe/Amsterdam",
		});
		assert.deepEqual(readCollectionTimezone(undefined), {
			ok: true,
			value: "",
		});
	});

	it("refuses a zone this server cannot resolve", () => {
		const timezone = readCollectionTimezone("Pacific Standard Time");
		assert.ok(!timezone.ok);
		assert.equal(timezone.error.code, "UnknownTimeZone");
	});
});

describe("updateCalendarFor", () => {
	const allDay = {
		summary: "Leave",
		start: "2026-06-01",
		end: "2026-06-02",
		allDay: true,
	};

	it("refuses a timezone this server cannot resolve", async () => {
		const account = anAccount();
		const deps = account.deps();
		const [calendar] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(calendar);

		const updated = await updateCalendarFor(
			deps,
			account.accountConfigId,
			calendar.calendarId,
			{ timezone: "Pacific Standard Time" },
		);

		assert.ok(!updated.ok);
		assert.equal(updated.error.code, "UnknownTimeZone");
		assert.equal((await account.collection(calendar.calendarId))?.timezone, "");
	});

	it("re-expands the calendar's events when its timezone changes", async () => {
		const account = anAccount();
		const deps = account.eventDeps();
		const [calendar] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(calendar);
		const created = await createCalendarEventFor(
			deps,
			account.accountConfigId,
			{ calendarId: calendar.calendarId, ...allDay },
		);
		assert.ok(created.ok, JSON.stringify(created));
		assert.equal(
			(await account.occurrences(created.value))[0]?.startAt,
			"2026-06-01T00:00:00Z",
			"an all-day event in a calendar with no zone starts at midnight UTC",
		);

		const updated = await updateCalendarFor(
			deps,
			account.accountConfigId,
			calendar.calendarId,
			{ timezone: "America/New_York" },
		);

		assert.ok(updated.ok, JSON.stringify(updated));
		assert.equal(
			(await account.occurrences(created.value))[0]?.startAt,
			"2026-06-01T04:00:00Z",
			"and midnight in the calendar's new zone once it has one",
		);
		assert.ok(
			updated.value.syncSequence > calendar.syncSequence,
			"a syncing client is told the calendar changed",
		);
	});

	it("leaves the events alone when only the name changes", async () => {
		const account = anAccount();
		const deps = account.eventDeps();
		const [calendar] = await listCalendarsFor(deps, account.accountConfigId);
		assert.ok(calendar);
		const created = await createCalendarEventFor(
			deps,
			account.accountConfigId,
			{ calendarId: calendar.calendarId, ...allDay },
		);
		assert.ok(created.ok);
		const before = (await account.collection(calendar.calendarId))
			?.syncSequence;

		const updated = await updateCalendarFor(
			deps,
			account.accountConfigId,
			calendar.calendarId,
			{ displayName: "Renamed" },
		);

		assert.ok(updated.ok);
		assert.equal(updated.value.displayName, "Renamed");
		assert.equal(updated.value.syncSequence, before);
	});
});

/**
 * The collection wrappers, driven the way an HTTP request drives them. The
 * suites above hold the inner functions; these hold what the API answers with.
 */

type Handler = (
	context: Context,
	event: APIGatewayProxyEvent,
) => Promise<Record<string, unknown>>;

const createCalendar =
	CalendarOperations.CalendarOperations_createCalendar as Handler;
const getCalendar =
	CalendarDetailOperations.CalendarDetailOperations_getCalendar as Handler;
const updateCalendar =
	CalendarDetailOperations.CalendarDetailOperations_updateCalendar as Handler;
const deleteCalendar =
	CalendarDetailOperations.CalendarDetailOperations_deleteCalendar as Handler;

const contextOf = (request: {
	params?: Record<string, string>;
	requestBody?: unknown;
}): Context => ({ request }) as unknown as Context;

describe("the calendar collection wrappers", () => {
	it("answers not-found for a collection on another account", async () => {
		const stranger = anAccount();
		const [theirs] = await listCalendarsFor(
			stranger.deps(),
			stranger.accountConfigId,
		);
		assert.ok(theirs);
		const event = anAccount().request();

		const read = await getCalendar(
			contextOf({ params: { calendarId: theirs.calendarId } }),
			event,
		);

		assert.equal(read.statusCode, 404);
		assert.equal((read.body as { code: string }).code, "NotFound");
	});

	it("refuses a second calendar under a segment the account already uses", async () => {
		const event = anAccount().request();
		await createCalendar(
			contextOf({ requestBody: { urlSegment: "work", displayName: "Work" } }),
			event,
		);

		const second = await createCalendar(
			contextOf({
				requestBody: { urlSegment: "Work", displayName: "Work again" },
			}),
			event,
		);

		assert.equal(second.statusCode, 400);
		assert.equal((second.body as { code: string }).code, "UrlSegmentTaken");
	});

	it("refuses a rename that names a zone this server cannot resolve", async () => {
		const account = anAccount();
		const event = account.request();
		const [calendar] = await listCalendarsFor(
			account.deps(),
			account.accountConfigId,
		);
		assert.ok(calendar);

		const updated = await updateCalendar(
			contextOf({
				params: { calendarId: calendar.calendarId },
				requestBody: { timezone: "Pacific Standard Time" },
			}),
			event,
		);

		assert.equal(updated.statusCode, 400);
		assert.equal((updated.body as { code: string }).code, "UnknownTimeZone");
	});

	it("answers 204 for a calendar it removed and 400 for the default one", async () => {
		const account = anAccount();
		const event = account.request();
		const held = await listCalendarsFor(
			account.deps(),
			account.accountConfigId,
		);
		const fallback = held.find(
			(collection) => collection.source === CalendarSource.Default,
		);
		assert.ok(fallback);
		const created = (await createCalendar(
			contextOf({ requestBody: { urlSegment: "work", displayName: "Work" } }),
			event,
		)) as unknown as { calendarId: string };

		const removed = await deleteCalendar(
			contextOf({ params: { calendarId: created.calendarId } }),
			event,
		);
		const refused = await deleteCalendar(
			contextOf({ params: { calendarId: fallback.calendarId } }),
			event,
		);

		assert.equal(removed.statusCode, 204);
		assert.equal(refused.statusCode, 400);
		assert.equal(
			(refused.body as { code: string }).code,
			"DefaultCalendarUndeletable",
		);
	});
});
