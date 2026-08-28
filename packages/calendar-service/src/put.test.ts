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
	PutCalendarObjectInput as PutCalendarObjectRow,
	UpdateCalendarCollectionInput,
} from "@remit/data-ports";
import {
	deriveCalendarId,
	deriveCalendarObjectId,
	normalizeCalendarUrlSegment,
} from "@remit/data-ports/id";
import { computeEtag } from "./etag.js";
import { asLf, singleEvent } from "./fixtures.js";
import { parseCalendar, serializeCalendar } from "./parse.js";
import {
	DEFAULT_CALENDAR_URL_SEGMENT,
	deleteCalendarObject,
	provisionDefaultCalendar,
	putCalendarObject,
} from "./put.js";

class MissingRow extends Error {}

/**
 * A pass-through unit of work over plain maps — the shape the port documents
 * for a backend with no cross-entity transaction. It proves the write path
 * calls what it should, in the order it should; that the three writes stand or
 * fall together is proven against a real transaction, in
 * drizzle-service's calendar-put.sqlite.test.ts.
 */
class MemoryCalendarStore implements ICalendarUnitOfWork {
	readonly collections = new Map<string, CalendarCollectionItem>();
	readonly objects = new Map<string, CalendarObjectItem>();
	readonly occurrences = new Map<string, CalendarEventIndexItem[]>();

	private readonly collectionRepo: ICalendarCollectionRepository = {
		create: async (input: CreateCalendarCollectionInput) => {
			const urlSegment = normalizeCalendarUrlSegment(input.urlSegment);
			const calendarId = deriveCalendarId(input.accountConfigId, urlSegment);
			const existing = this.collections.get(calendarId);
			if (existing) return existing;
			const now = Date.now();
			const collection: CalendarCollectionItem = {
				calendarId,
				accountConfigId: input.accountConfigId,
				urlSegment,
				displayName: input.displayName,
				color: input.color ?? "Cal1",
				componentSet: input.componentSet ?? "VeventOnly",
				source: input.source ?? "UserCreated",
				timezone: input.timezone ?? "",
				syncSequence: 0,
				createdAt: now,
				updatedAt: now,
			};
			this.collections.set(calendarId, collection);
			return collection;
		},
		get: async (_accountConfigId: string, calendarId: string) => {
			const collection = this.collections.get(calendarId);
			if (!collection) throw new MissingRow(calendarId);
			return collection;
		},
		update: async (
			_accountConfigId: string,
			calendarId: string,
			input: UpdateCalendarCollectionInput,
		) => {
			const collection = this.collections.get(calendarId);
			if (!collection) throw new MissingRow(calendarId);
			const updated = { ...collection, ...input };
			this.collections.set(calendarId, updated);
			return updated;
		},
		delete: async (_accountConfigId: string, calendarId: string) => {
			this.collections.delete(calendarId);
		},
		listByAccountConfig: async (accountConfigId: string) =>
			[...this.collections.values()].filter(
				(collection) => collection.accountConfigId === accountConfigId,
			),
		findByUrlSegment: async (accountConfigId: string, urlSegment: string) =>
			this.collections.get(deriveCalendarId(accountConfigId, urlSegment)) ??
			null,
		bumpSyncSequence: async (_accountConfigId: string, calendarId: string) => {
			const collection = this.collections.get(calendarId);
			if (!collection) throw new MissingRow(calendarId);
			const bumped = {
				...collection,
				syncSequence: collection.syncSequence + 1,
			};
			this.collections.set(calendarId, bumped);
			return bumped.syncSequence;
		},
	};

	private readonly objectRepo: ICalendarObjectRepository = {
		put: async (input: PutCalendarObjectRow) => {
			const calendarObjectId = deriveCalendarObjectId(
				input.calendarId,
				input.resourceName,
			);
			const now = Date.now();
			const object: CalendarObjectItem = {
				...input,
				calendarObjectId,
				createdAt: this.objects.get(calendarObjectId)?.createdAt ?? now,
				updatedAt: now,
			};
			this.objects.set(calendarObjectId, object);
			return object;
		},
		get: async (_calendarId: string, calendarObjectId: string) => {
			const object = this.objects.get(calendarObjectId);
			if (!object) throw new MissingRow(calendarObjectId);
			return object;
		},
		delete: async (_calendarId: string, calendarObjectId: string) => {
			this.objects.delete(calendarObjectId);
		},
		findByResourceName: async (calendarId: string, resourceName: string) =>
			this.objects.get(deriveCalendarObjectId(calendarId, resourceName)) ??
			null,
		findByUid: async (calendarId: string, icalUid: string) =>
			[...this.objects.values()].find(
				(object) =>
					object.calendarId === calendarId && object.icalUid === icalUid,
			) ?? null,
		listByCalendar: async (calendarId: string) =>
			[...this.objects.values()].filter(
				(object) => object.calendarId === calendarId,
			),
		listChangedSince: async (calendarId: string, syncSequence: number) =>
			[...this.objects.values()]
				.filter(
					(object) =>
						object.calendarId === calendarId &&
						object.syncSequence > syncSequence,
				)
				.sort((left, right) => left.syncSequence - right.syncSequence),
	};

	private readonly eventIndexRepo: ICalendarEventIndexRepository = {
		replaceForObject: async (
			calendarId: string,
			calendarObjectId: string,
			occurrences: CalendarOccurrenceInput[],
		) => {
			const now = Date.now();
			this.occurrences.set(
				calendarObjectId,
				occurrences.map((occurrence) => ({
					...occurrence,
					calendarId,
					calendarObjectId,
					createdAt: now,
					updatedAt: now,
				})),
			);
		},
		deleteForObject: async (_calendarId: string, calendarObjectId: string) => {
			this.occurrences.delete(calendarObjectId);
		},
		listForObject: async (_calendarId: string, calendarObjectId: string) =>
			this.occurrences.get(calendarObjectId) ?? [],
		listByStartRange: async (
			calendarId: string,
			startAt: string,
			endAt: string,
		) =>
			[...this.occurrences.values()]
				.flat()
				.filter(
					(row) =>
						row.calendarId === calendarId &&
						row.startAt >= startAt &&
						row.startAt < endAt,
				)
				.sort((left, right) => left.startAt.localeCompare(right.startAt)),
	};

	transaction<T>(
		fn: (repos: {
			calendarCollection: ICalendarCollectionRepository;
			calendarObject: ICalendarObjectRepository;
			calendarEventIndex: ICalendarEventIndexRepository;
		}) => Promise<T>,
	): Promise<T> {
		return fn({
			calendarCollection: this.collectionRepo,
			calendarObject: this.objectRepo,
			calendarEventIndex: this.eventIndexRepo,
		});
	}
}

const ACCOUNT_CONFIG_ID = "account-config-1";

const provisioned = async (): Promise<{
	store: MemoryCalendarStore;
	calendarId: string;
}> => {
	const store = new MemoryCalendarStore();
	const collection = await provisionDefaultCalendar(store, ACCOUNT_CONFIG_ID);
	return { store, calendarId: collection.calendarId };
};

const RESOURCE = singleEvent(
	"DTSTART:20260826T090000Z",
	"DTEND:20260826T100000Z",
	"SUMMARY:Quarterly review",
);

describe("provisionDefaultCalendar", () => {
	it("gives an account config a default collection at the default segment", async () => {
		const store = new MemoryCalendarStore();

		const collection = await provisionDefaultCalendar(store, ACCOUNT_CONFIG_ID);

		assert.equal(collection.urlSegment, DEFAULT_CALENDAR_URL_SEGMENT);
		assert.equal(collection.source, "Default");
		assert.equal(collection.displayName, "Calendar");
	});

	it("returns the same collection on a second first use", async () => {
		const store = new MemoryCalendarStore();

		const first = await provisionDefaultCalendar(store, ACCOUNT_CONFIG_ID);
		const second = await provisionDefaultCalendar(store, ACCOUNT_CONFIG_ID);

		assert.equal(second.calendarId, first.calendarId);
		assert.equal(store.collections.size, 1);
	});
});

describe("putCalendarObject", () => {
	it("stores the bytes it was given, untouched", async () => {
		const { store, calendarId } = await provisioned();

		const result = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "review.ics",
			icalData: RESOURCE,
		});

		assert.ok(result.ok);
		assert.equal(result.value.icalData, RESOURCE);
		assert.equal(result.value.summary, "Quarterly review");
		assert.equal(result.value.icalUid, "fixture@example.com");
	});

	it("stores the input bytes rather than a reserialization of them", async () => {
		// The etag is a digest of what the writer sent. ical.js refolds and
		// reorders on serialize, so a write path that stored its own
		// reserialization would hand back a tag for bytes nobody wrote, and every
		// client's cached copy would miss on the next read.
		const { store, calendarId } = await provisioned();
		const source = singleEvent(
			"DTSTART:20260826T090000Z",
			"DTEND:20260826T100000Z",
			"SUMMARY:A summary long enough that RFC 5545 line folding rewrites it when ical.js serializes the event again",
			"X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
		);
		const parsed = await parseCalendar(source);
		assert.ok(parsed.ok);
		const reserialized = serializeCalendar(parsed.value.component);
		assert.notEqual(
			reserialized,
			source,
			"the fixture survives reserialization unchanged, so it proves nothing",
		);

		const result = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "folded.ics",
			icalData: source,
		});

		assert.ok(result.ok);
		assert.equal(result.value.icalData, source);
		assert.equal(result.value.etag, computeEtag(source));
		assert.notEqual(result.value.etag, computeEtag(reserialized));
	});

	it("stores an LF-only resource as it arrived, without normalizing it", async () => {
		// The store keeps what the writer sent. Rewriting line endings on the way
		// in would give the resource an etag for bytes nobody wrote, and the
		// writer's own If-Match would miss on its very next request.
		const { store, calendarId } = await provisioned();
		const source = asLf(RESOURCE);

		const result = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "lf.ics",
			icalData: source,
		});

		assert.ok(result.ok);
		assert.equal(result.value.icalData, source);
		assert.ok(!result.value.icalData.includes("\r"));
		assert.equal(result.value.etag, computeEtag(source));
		assert.equal(result.value.summary, "Quarterly review");
		assert.equal(result.value.dtStart, "2026-08-26T09:00:00+00:00");
	});

	it("writes the occurrence rows the resource expands to", async () => {
		const { store, calendarId } = await provisioned();

		const result = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "series.ics",
			icalData: singleEvent(
				"DTSTART:20260826T090000Z",
				"DTEND:20260826T100000Z",
				"RRULE:FREQ=WEEKLY;COUNT=3",
			),
		});

		assert.ok(result.ok);
		assert.equal(
			store.occurrences.get(result.value.calendarObjectId)?.length,
			3,
		);
	});

	it("replaces the occurrences of a resource it rewrites", async () => {
		const { store, calendarId } = await provisioned();
		const input = {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "series.ics",
		};

		await putCalendarObject(store, {
			...input,
			icalData: singleEvent(
				"DTSTART:20260826T090000Z",
				"DTEND:20260826T100000Z",
				"RRULE:FREQ=WEEKLY;COUNT=5",
			),
		});
		const result = await putCalendarObject(store, {
			...input,
			icalData: singleEvent(
				"DTSTART:20260826T090000Z",
				"DTEND:20260826T100000Z",
				"RRULE:FREQ=WEEKLY;COUNT=2",
			),
		});

		assert.ok(result.ok);
		assert.equal(store.objects.size, 1);
		assert.equal(
			store.occurrences.get(result.value.calendarObjectId)?.length,
			2,
		);
	});

	it("stamps the collection's new sequence on the resource it wrote", async () => {
		const { store, calendarId } = await provisioned();

		const first = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "one.ics",
			icalData: RESOURCE,
		});
		const second = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "two.ics",
			icalData: singleEvent(
				"DTSTART:20260827T090000Z",
				"DTEND:20260827T100000Z",
			),
		});

		assert.ok(first.ok);
		assert.ok(second.ok);
		assert.equal(first.value.syncSequence, 1);
		assert.equal(second.value.syncSequence, 2);
		assert.equal(store.collections.get(calendarId)?.syncSequence, 2);
	});

	it("computes the etag over the stored bytes", async () => {
		const { store, calendarId } = await provisioned();

		const result = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "review.ics",
			icalData: RESOURCE,
		});

		assert.ok(result.ok);
		assert.match(result.value.etag, /^[0-9a-f]{64}$/);
	});

	it("refuses a resource the collection does not store, and writes nothing", async () => {
		const { store, calendarId } = await provisioned();

		const result = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "todo.ics",
			icalData: [
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VTODO",
				"UID:todo@example.com",
				"END:VTODO",
				"END:VCALENDAR",
				"",
			].join("\r\n"),
		});

		assert.ok(!result.ok);
		assert.equal(result.error.code, "UnsupportedComponent");
		assert.equal(store.objects.size, 0);
		assert.equal(store.collections.get(calendarId)?.syncSequence, 0);
	});

	it("refuses an event that ends before it starts", async () => {
		const { store, calendarId } = await provisioned();

		const result = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "backwards.ics",
			icalData: singleEvent(
				"DTSTART:20260826T100000Z",
				"DTEND:20260826T090000Z",
			),
		});

		assert.ok(!result.ok);
		assert.equal(result.error.code, "BackwardsEnd");
		assert.equal(store.objects.size, 0);
	});

	it("fails loudly when the collection does not exist", async () => {
		const store = new MemoryCalendarStore();

		await assert.rejects(
			putCalendarObject(store, {
				accountConfigId: ACCOUNT_CONFIG_ID,
				calendarId: "no-such-calendar",
				resourceName: "review.ics",
				icalData: RESOURCE,
			}),
			MissingRow,
		);
	});

	it("projects the event in the collection's timezone", async () => {
		const store = new MemoryCalendarStore();
		const collection = await store.transaction((repos) =>
			repos.calendarCollection.create({
				accountConfigId: ACCOUNT_CONFIG_ID,
				urlSegment: "berlin",
				displayName: "Berlin",
				timezone: "Europe/Berlin",
			}),
		);

		const result = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId: collection.calendarId,
			resourceName: "floating.ics",
			icalData: singleEvent("DTSTART:20260826T090000", "DTEND:20260826T100000"),
		});

		assert.ok(result.ok);
		assert.equal(result.value.dtStart, "2026-08-26T09:00:00+02:00");
	});
});

describe("deleteCalendarObject", () => {
	it("takes the occurrences with the resource and bumps the collection", async () => {
		const { store, calendarId } = await provisioned();
		const written = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "review.ics",
			icalData: RESOURCE,
		});
		assert.ok(written.ok);

		await deleteCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			calendarObjectId: written.value.calendarObjectId,
		});

		assert.equal(store.objects.size, 0);
		assert.equal(store.occurrences.size, 0);
		assert.equal(store.collections.get(calendarId)?.syncSequence, 2);
	});
});
