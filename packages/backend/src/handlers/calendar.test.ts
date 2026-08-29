import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	CalendarCollectionItem,
	CalendarEventIndexItem,
	CalendarObjectItem,
	CalendarOccurrenceInput,
	CreateCalendarCollectionInput,
	ICalendarCollectionRepository,
	ICalendarEventIndexRepository,
	ICalendarObjectRepository,
	ICalendarUnitOfWork,
	PutCalendarObjectInput,
	UpdateCalendarCollectionInput,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import {
	deriveCalendarId,
	deriveCalendarObjectId,
	normalizeCalendarUrlSegment,
} from "@remit/data-ports/id";
import {
	CalendarColor,
	CalendarComponentSet,
	CalendarSource,
	RecurrenceScope,
} from "@remit/domain-enums";
import {
	type CalendarDeps,
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

/**
 * The calendar store in memory, behind the same ports the relational one
 * implements — one class per port, because a collection and a resource both
 * answer to `get` and `delete` with different arguments.
 *
 * Written against the ports rather than stubbed per test so a handler test
 * exercises the real write path: `putCalendarObject` projects, expands and
 * bumps here exactly as it does against sqlite, and a handler that stopped
 * going through it would fail these tests rather than pass them.
 */
class CalendarState {
	readonly collections = new Map<string, CalendarCollectionItem>();
	readonly objects = new Map<string, CalendarObjectItem>();
	readonly occurrences = new Map<string, CalendarEventIndexItem[]>();
}

class MemoryCollections implements ICalendarCollectionRepository {
	constructor(private state: CalendarState) {}

	async create(
		input: CreateCalendarCollectionInput,
	): Promise<CalendarCollectionItem> {
		const urlSegment = normalizeCalendarUrlSegment(input.urlSegment);
		const calendarId = deriveCalendarId(input.accountConfigId, urlSegment);
		const existing = this.state.collections.get(calendarId);
		if (existing) return existing;

		const created: CalendarCollectionItem = {
			calendarId,
			accountConfigId: input.accountConfigId,
			urlSegment,
			displayName: input.displayName,
			color: input.color ?? CalendarColor.Cal1,
			componentSet: input.componentSet ?? CalendarComponentSet.VeventOnly,
			source: input.source ?? CalendarSource.UserCreated,
			timezone: input.timezone ?? "",
			syncSequence: 0,
			createdAt: 0,
			updatedAt: 0,
		};
		this.state.collections.set(calendarId, created);
		return created;
	}

	async createExclusive(
		input: CreateCalendarCollectionInput,
	): Promise<CalendarCollectionItem | null> {
		const calendarId = deriveCalendarId(
			input.accountConfigId,
			normalizeCalendarUrlSegment(input.urlSegment),
		);
		if (this.state.collections.has(calendarId)) return null;
		return this.create(input);
	}

	async get(
		accountConfigId: string,
		calendarId: string,
	): Promise<CalendarCollectionItem> {
		const found = this.state.collections.get(calendarId);
		if (!found || found.accountConfigId !== accountConfigId) {
			throw new NotFoundError(`Calendar not found: ${calendarId}`);
		}
		return found;
	}

	async update(
		accountConfigId: string,
		calendarId: string,
		input: UpdateCalendarCollectionInput,
	): Promise<CalendarCollectionItem> {
		const updated = {
			...(await this.get(accountConfigId, calendarId)),
			...input,
		};
		this.state.collections.set(calendarId, updated);
		return updated;
	}

	async delete(_accountConfigId: string, calendarId: string): Promise<void> {
		this.state.collections.delete(calendarId);
	}

	async listByAccountConfig(
		accountConfigId: string,
	): Promise<CalendarCollectionItem[]> {
		return [...this.state.collections.values()]
			.filter((item) => item.accountConfigId === accountConfigId)
			.sort((left, right) => left.urlSegment.localeCompare(right.urlSegment));
	}

	async findByUrlSegment(
		accountConfigId: string,
		urlSegment: string,
	): Promise<CalendarCollectionItem | null> {
		return (
			this.state.collections.get(
				deriveCalendarId(
					accountConfigId,
					normalizeCalendarUrlSegment(urlSegment),
				),
			) ?? null
		);
	}

	async bumpSyncSequence(
		accountConfigId: string,
		calendarId: string,
	): Promise<number> {
		const current = await this.get(accountConfigId, calendarId);
		const bumped = { ...current, syncSequence: current.syncSequence + 1 };
		this.state.collections.set(calendarId, bumped);
		return bumped.syncSequence;
	}
}

class MemoryObjects implements ICalendarObjectRepository {
	constructor(private state: CalendarState) {}

	async put(input: PutCalendarObjectInput): Promise<CalendarObjectItem> {
		const calendarObjectId = deriveCalendarObjectId(
			input.calendarId,
			input.resourceName,
		);
		const stored: CalendarObjectItem = {
			...input,
			calendarObjectId,
			createdAt: 0,
			updatedAt: 0,
		};
		this.state.objects.set(calendarObjectId, stored);
		return stored;
	}

	async get(
		calendarId: string,
		calendarObjectId: string,
	): Promise<CalendarObjectItem> {
		const found = await this.find(calendarId, calendarObjectId);
		if (!found) {
			throw new NotFoundError(`Calendar object not found: ${calendarObjectId}`);
		}
		return found;
	}

	async find(
		calendarId: string,
		calendarObjectId: string,
	): Promise<CalendarObjectItem | null> {
		const found = this.state.objects.get(calendarObjectId);
		return found && found.calendarId === calendarId ? found : null;
	}

	async delete(_calendarId: string, calendarObjectId: string): Promise<void> {
		this.state.objects.delete(calendarObjectId);
	}

	async findByResourceName(
		calendarId: string,
		resourceName: string,
	): Promise<CalendarObjectItem | null> {
		return this.find(
			calendarId,
			deriveCalendarObjectId(calendarId, resourceName),
		);
	}

	async findByUid(
		calendarId: string,
		icalUid: string,
	): Promise<CalendarObjectItem | null> {
		return (
			[...this.state.objects.values()].find(
				(object) =>
					object.calendarId === calendarId && object.icalUid === icalUid,
			) ?? null
		);
	}

	async listByCalendar(calendarId: string): Promise<CalendarObjectItem[]> {
		return [...this.state.objects.values()]
			.filter((object) => object.calendarId === calendarId)
			.sort((left, right) =>
				left.resourceName.localeCompare(right.resourceName),
			);
	}

	async listIncompleteExpansions(
		calendarId: string,
		instant: string,
	): Promise<CalendarObjectItem[]> {
		return (await this.listByCalendar(calendarId)).filter(
			(object) =>
				object.expandedThrough !== "" && object.expandedThrough < instant,
		);
	}

	async listChangedSince(
		calendarId: string,
		syncSequence: number,
	): Promise<CalendarObjectItem[]> {
		return (await this.listByCalendar(calendarId))
			.filter((object) => object.syncSequence > syncSequence)
			.sort((left, right) => left.syncSequence - right.syncSequence);
	}
}

class MemoryOccurrences implements ICalendarEventIndexRepository {
	constructor(private state: CalendarState) {}

	async replaceForObject(
		calendarId: string,
		calendarObjectId: string,
		occurrences: CalendarOccurrenceInput[],
	): Promise<void> {
		this.state.occurrences.set(
			calendarObjectId,
			occurrences.map((occurrence) => ({
				...occurrence,
				calendarId,
				calendarObjectId,
				createdAt: 0,
				updatedAt: 0,
			})),
		);
	}

	async deleteForObject(
		_calendarId: string,
		calendarObjectId: string,
	): Promise<void> {
		this.state.occurrences.delete(calendarObjectId);
	}

	async listForObject(
		_calendarId: string,
		calendarObjectId: string,
	): Promise<CalendarEventIndexItem[]> {
		return this.state.occurrences.get(calendarObjectId) ?? [];
	}

	async listByStartRange(
		calendarId: string,
		startAt: string,
		endAt: string,
	): Promise<CalendarEventIndexItem[]> {
		return [...this.state.occurrences.values()]
			.flat()
			.filter(
				(row) =>
					row.calendarId === calendarId &&
					row.startAt >= startAt &&
					row.startAt < endAt,
			)
			.sort((left, right) => left.startAt.localeCompare(right.startAt));
	}
}

class InMemoryCalendarStore implements ICalendarUnitOfWork {
	readonly state = new CalendarState();
	readonly calendarCollection = new MemoryCollections(this.state);
	readonly calendarObject = new MemoryObjects(this.state);
	readonly calendarEventIndex = new MemoryOccurrences(this.state);

	get collections(): Map<string, CalendarCollectionItem> {
		return this.state.collections;
	}

	get objects(): Map<string, CalendarObjectItem> {
		return this.state.objects;
	}

	get occurrences(): Map<string, CalendarEventIndexItem[]> {
		return this.state.occurrences;
	}

	// No isolation to model: the tests that care about atomicity run against
	// sqlite, where the transaction is real.
	transaction<T>(
		fn: (repos: {
			calendarCollection: ICalendarCollectionRepository;
			calendarObject: ICalendarObjectRepository;
			calendarEventIndex: ICalendarEventIndexRepository;
		}) => Promise<T>,
	): Promise<T> {
		return fn(this);
	}

	deps(): CalendarDeps {
		return {
			calendarCollection: this.calendarCollection,
			calendarObject: this.calendarObject,
			calendarEventIndex: this.calendarEventIndex,
			calendarUnitOfWork: this,
		};
	}
}

const ACCOUNT = "account-config-1";

const eventDeps = (store: InMemoryCalendarStore): CalendarEventDeps => {
	let minted = 0;
	return {
		...store.deps(),
		newId: () => {
			minted += 1;
			return `minted-${minted}`;
		},
		now: () => new Date("2026-08-29T00:00:00Z"),
	};
};

const seedWeekly = async (
	deps: CalendarEventDeps,
	calendarId: string,
	recurrenceRule = "FREQ=WEEKLY;COUNT=5",
) => {
	const created = await createCalendarEventFor(deps, ACCOUNT, {
		calendarId,
		summary: "Stand-up",
		start: "2026-09-07T09:00:00Z",
		end: "2026-09-07T10:00:00Z",
		recurrenceRule,
	});
	assert.ok(created.ok, JSON.stringify(created));
	return created.value;
};

describe("listCalendarsFor", () => {
	it("provisions the default calendar on a first read", async () => {
		const store = new InMemoryCalendarStore();

		const calendars = await listCalendarsFor(store.deps(), ACCOUNT);

		assert.equal(calendars.length, 1);
		assert.equal(calendars[0]?.urlSegment, "default");
		assert.equal(calendars[0]?.source, CalendarSource.Default);
	});

	it("provisions it exactly once when several reads arrive together", async () => {
		const store = new InMemoryCalendarStore();

		const reads = await Promise.all(
			Array.from({ length: 8 }, () => listCalendarsFor(store.deps(), ACCOUNT)),
		);

		assert.equal(store.collections.size, 1);
		const ids = new Set(reads.flat().map((calendar) => calendar.calendarId));
		assert.equal(ids.size, 1);
	});
});

describe("createCalendarFor", () => {
	it("refuses a url segment the account already uses", async () => {
		const store = new InMemoryCalendarStore();
		const deps = store.deps();
		await createCalendarFor(deps, ACCOUNT, {
			urlSegment: "work",
			displayName: "Work",
		});

		const second = await createCalendarFor(deps, ACCOUNT, {
			urlSegment: "WORK",
			displayName: "Work again",
		});

		assert.ok(!second.ok);
		assert.equal(second.error.code, "UrlSegmentTaken");
		assert.equal(store.collections.size, 1);
		assert.equal(
			[...store.collections.values()][0]?.displayName,
			"Work",
			"the refused create never wrote over the calendar that holds the segment",
		);
	});

	it("refuses an empty url segment", async () => {
		const store = new InMemoryCalendarStore();

		const created = await createCalendarFor(store.deps(), ACCOUNT, {
			urlSegment: "  ",
			displayName: "Nameless",
		});

		assert.ok(!created.ok);
		assert.equal(created.error.code, "InvalidUrlSegment");
	});
});

describe("deleteCalendarFor", () => {
	it("refuses to remove the calendar events fall back to", async () => {
		const store = new InMemoryCalendarStore();
		const deps = store.deps();
		const [fallback] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(fallback);

		const removed = await deleteCalendarFor(deps, ACCOUNT, fallback.calendarId);

		assert.ok(!removed.ok);
		assert.equal(removed.error.code, "DefaultCalendarUndeletable");
		assert.equal(store.collections.size, 1);
	});

	it("takes the events and their occurrences with a calendar it does remove", async () => {
		const store = new InMemoryCalendarStore();
		const deps = eventDeps(store);
		const created = await createCalendarFor(deps, ACCOUNT, {
			urlSegment: "work",
			displayName: "Work",
		});
		assert.ok(created.ok);
		await seedWeekly(deps, created.value.calendarId);
		assert.equal(store.objects.size, 1);

		const removed = await deleteCalendarFor(
			deps,
			ACCOUNT,
			created.value.calendarId,
		);

		assert.ok(removed.ok);
		assert.equal(store.objects.size, 0);
		assert.equal(store.occurrences.size, 0);
	});

	it("answers not-found for a calendar on another account", async () => {
		const store = new InMemoryCalendarStore();
		const deps = store.deps();
		const [mine] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(mine);

		const removed = await deleteCalendarFor(
			deps,
			"someone-else",
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
		const store = new InMemoryCalendarStore();
		const deps = eventDeps(store);
		const [calendar] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(calendar);
		const event = await seedWeekly(deps, calendar.calendarId);

		const first = await updateCalendarEventFor(
			deps,
			ACCOUNT,
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
			ACCOUNT,
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
		assert.equal(
			store.objects.get(event.calendarObjectId)?.summary,
			"Stand-up (renamed)",
			"the losing write left the resource alone",
		);
	});

	it("writes both resources of a Following split", async () => {
		const store = new InMemoryCalendarStore();
		const deps = eventDeps(store);
		const [calendar] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(calendar);
		const event = await seedWeekly(deps, calendar.calendarId);

		const split = await updateCalendarEventFor(
			deps,
			ACCOUNT,
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
		assert.equal(store.objects.size, 2);
		const [head, tail] = [...store.objects.values()].sort((left, right) =>
			left.dtStart.localeCompare(right.dtStart),
		);
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
		const store = new InMemoryCalendarStore();
		const deps = eventDeps(store);
		const [calendar] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(calendar);

		const updated = await updateCalendarEventFor(
			deps,
			ACCOUNT,
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
		const store = new InMemoryCalendarStore();
		const deps = eventDeps(store);
		const [calendar] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(calendar);
		const event = await seedWeekly(deps, calendar.calendarId);

		const removed = await deleteCalendarEventFor(deps, ACCOUNT, {
			calendarId: calendar.calendarId,
			calendarObjectId: event.calendarObjectId,
			scope: RecurrenceScope.All,
			recurrenceId: "",
			ifMatch: undefined,
		});

		assert.ok(removed.ok);
		assert.equal(store.objects.size, 0);
		assert.equal(store.occurrences.size, 0);
	});

	it("keeps the series under scope=This and drops one occurrence from it", async () => {
		const store = new InMemoryCalendarStore();
		const deps = eventDeps(store);
		const [calendar] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(calendar);
		const event = await seedWeekly(deps, calendar.calendarId);
		assert.equal(store.occurrences.get(event.calendarObjectId)?.length, 5);

		const removed = await deleteCalendarEventFor(deps, ACCOUNT, {
			calendarId: calendar.calendarId,
			calendarObjectId: event.calendarObjectId,
			scope: RecurrenceScope.This,
			recurrenceId: "2026-09-21T09:00:00Z",
			ifMatch: undefined,
		});

		assert.ok(removed.ok);
		assert.equal(store.objects.size, 1);
		const rows = store.occurrences.get(event.calendarObjectId) ?? [];
		assert.equal(rows.length, 4);
		assert.equal(
			rows.some((row) => row.startAt === "2026-09-21T09:00:00Z"),
			false,
		);
	});

	it("refuses a per-occurrence delete of an event that happens once", async () => {
		const store = new InMemoryCalendarStore();
		const deps = eventDeps(store);
		const [calendar] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(calendar);
		const event = await seedWeekly(deps, calendar.calendarId, "");

		const removed = await deleteCalendarEventFor(deps, ACCOUNT, {
			calendarId: calendar.calendarId,
			calendarObjectId: event.calendarObjectId,
			scope: RecurrenceScope.This,
			recurrenceId: "2026-09-07T09:00:00Z",
			ifMatch: undefined,
		});

		assert.ok(!removed.ok);
		assert.equal(removed.error.code, "NotRecurring");
		assert.equal(store.objects.size, 1);
	});
});

describe("createCalendarEventFor", () => {
	it("refuses an event aimed at a calendar the account does not hold", async () => {
		const store = new InMemoryCalendarStore();
		const deps = eventDeps(store);

		const created = await createCalendarEventFor(deps, ACCOUNT, {
			calendarId: "someone-elses-calendar",
			summary: "Stand-up",
			start: "2026-09-07T09:00:00Z",
			end: "2026-09-07T10:00:00Z",
		});

		assert.ok(!created.ok);
		assert.equal(created.error.code, "NotFound");
	});

	it("refuses an event that ends before it starts", async () => {
		const store = new InMemoryCalendarStore();
		const deps = eventDeps(store);
		const [calendar] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(calendar);

		const created = await createCalendarEventFor(deps, ACCOUNT, {
			calendarId: calendar.calendarId,
			summary: "Backwards",
			start: "2026-09-07T10:00:00Z",
			end: "2026-09-07T09:00:00Z",
		});

		assert.ok(!created.ok);
		assert.equal(created.error.code, "BackwardsEnd");
		assert.equal(store.objects.size, 0);
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
		const store = new InMemoryCalendarStore();
		const deps = store.deps();
		const [calendar] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(calendar);

		const updated = await updateCalendarFor(
			deps,
			ACCOUNT,
			calendar.calendarId,
			{
				timezone: "Pacific Standard Time",
			},
		);

		assert.ok(!updated.ok);
		assert.equal(updated.error.code, "UnknownTimeZone");
		assert.equal(store.collections.get(calendar.calendarId)?.timezone, "");
	});

	it("re-expands the calendar's events when its timezone changes", async () => {
		const store = new InMemoryCalendarStore();
		const deps = eventDeps(store);
		const [calendar] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(calendar);
		const created = await createCalendarEventFor(deps, ACCOUNT, {
			calendarId: calendar.calendarId,
			...allDay,
		});
		assert.ok(created.ok, JSON.stringify(created));
		assert.equal(
			store.occurrences.get(created.value.calendarObjectId)?.[0]?.startAt,
			"2026-06-01T00:00:00Z",
			"an all-day event in a calendar with no zone starts at midnight UTC",
		);

		const updated = await updateCalendarFor(
			deps,
			ACCOUNT,
			calendar.calendarId,
			{
				timezone: "America/New_York",
			},
		);

		assert.ok(updated.ok, JSON.stringify(updated));
		assert.equal(
			store.occurrences.get(created.value.calendarObjectId)?.[0]?.startAt,
			"2026-06-01T04:00:00Z",
			"and midnight in the calendar's new zone once it has one",
		);
		assert.ok(
			updated.value.syncSequence > calendar.syncSequence,
			"a syncing client is told the calendar changed",
		);
	});

	it("leaves the events alone when only the name changes", async () => {
		const store = new InMemoryCalendarStore();
		const deps = eventDeps(store);
		const [calendar] = await listCalendarsFor(deps, ACCOUNT);
		assert.ok(calendar);
		const created = await createCalendarEventFor(deps, ACCOUNT, {
			calendarId: calendar.calendarId,
			...allDay,
		});
		assert.ok(created.ok);
		const before = store.collections.get(calendar.calendarId)?.syncSequence;

		const updated = await updateCalendarFor(
			deps,
			ACCOUNT,
			calendar.calendarId,
			{
				displayName: "Renamed",
			},
		);

		assert.ok(updated.ok);
		assert.equal(updated.value.displayName, "Renamed");
		assert.equal(updated.value.syncSequence, before);
	});
});
