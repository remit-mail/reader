import type {
	CalendarCollectionItem,
	CalendarObjectItem,
	DeleteCalendarObjectWrite,
	ICalendarStore,
	PutCalendarObjectWrite,
} from "@remit/data-ports";
import { deriveCalendarObjectId } from "@remit/data-ports/id";
import { CalendarSource } from "@remit/domain-enums";
import type { CalendarResult } from "./errors.js";
import { computeEtag } from "./etag.js";
import { expandCalendar } from "./expand.js";
import { parseCalendar } from "./parse.js";
import { projectCalendar } from "./project.js";

/** URL segment of the collection every account config is provisioned with. */
export const DEFAULT_CALENDAR_URL_SEGMENT = "default";

export interface PutCalendarObjectInput {
	accountConfigId: string;
	calendarId: string;
	/** Last path segment of the resource's URL, e.g. `"a1b2c3.ics"`. */
	resourceName: string;
	/** The VCALENDAR text as it arrived, stored byte-for-byte. */
	icalData: string;
}

/**
 * Turns one calendar resource into the write that stores it, read in the
 * collection's timezone. Every caller that stores an event goes through here —
 * a REST handler, a DAV PUT, an accepted suggestion, a feed refresh — because
 * the object row, its occurrence rows and the collection's sequence bump are
 * one fact, and a caller that writes any of them alone leaves the store
 * describing a calendar that does not exist.
 *
 * The bytes are stored exactly as given: parsing is for validating and
 * projecting them, never for rewriting them. Refusing the resource is a
 * returned value — the input is client-supplied, so malformed iCalendar is an
 * outcome the caller renders, not a fault.
 */
export const prepareCalendarObject = async (
	collection: Pick<CalendarCollectionItem, "timezone">,
	input: PutCalendarObjectInput,
): Promise<CalendarResult<PutCalendarObjectWrite>> => {
	const parsed = await parseCalendar(input.icalData);
	if (!parsed.ok) return parsed;

	const projection = projectCalendar(parsed.value, collection.timezone);
	if (!projection.ok) return projection;

	const expansion = expandCalendar(parsed.value, collection.timezone);
	return {
		ok: true,
		value: {
			kind: "PutObject",
			accountConfigId: input.accountConfigId,
			object: {
				...projection.value,
				calendarId: input.calendarId,
				resourceName: input.resourceName,
				icalData: input.icalData,
				etag: computeEtag(input.icalData),
				expandedThrough: expansion.expandedThrough,
			},
			occurrences: expansion.occurrences,
		},
	};
};

/** The resource a committed put wrote, under the id its name derives to. */
export const readWrittenObject = (
	store: ICalendarStore,
	write: PutCalendarObjectWrite,
): Promise<CalendarObjectItem> =>
	store.repos.calendarObject.get(
		write.object.calendarId,
		deriveCalendarObjectId(write.object.calendarId, write.object.resourceName),
	);

/** Writes one calendar resource into its collection. */
export const putCalendarObject = async (
	store: ICalendarStore,
	input: PutCalendarObjectInput,
): Promise<CalendarResult<CalendarObjectItem>> => {
	const collection = await store.repos.calendarCollection.get(
		input.accountConfigId,
		input.calendarId,
	);
	const write = await prepareCalendarObject(collection, input);
	if (!write.ok) return write;
	await store.commit([write.value]);
	return { ok: true, value: await readWrittenObject(store, write.value) };
};

/**
 * Removes a resource and the occurrences it produced — an object dropped
 * without its occurrence rows leaves a calendar showing events no resource
 * backs, which nothing later can attribute or clean up.
 */
export const deleteCalendarObjectWrite = (input: {
	accountConfigId: string;
	calendarId: string;
	calendarObjectId: string;
}): DeleteCalendarObjectWrite => ({ kind: "DeleteObject", ...input });

export const deleteCalendarObject = async (
	store: ICalendarStore,
	input: {
		accountConfigId: string;
		calendarId: string;
		calendarObjectId: string;
	},
): Promise<void> => {
	await store.commit([deleteCalendarObjectWrite(input)]);
};

/**
 * The collection an account config stores events in until someone makes
 * another. Safe to call on every request that needs a calendar: `calendarId` is
 * derived from the account config and the URL segment, so a second call returns
 * the collection the first one made rather than a rival copy of it.
 */
export const provisionDefaultCalendar = (
	store: ICalendarStore,
	accountConfigId: string,
	displayName = "Calendar",
): Promise<CalendarCollectionItem> =>
	store.repos.calendarCollection.create({
		accountConfigId,
		urlSegment: DEFAULT_CALENDAR_URL_SEGMENT,
		displayName,
		source: CalendarSource.Default,
	});
