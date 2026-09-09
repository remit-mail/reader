import type {
	CalendarCollectionItem,
	CalendarObjectItem,
	ICalendarUnitOfWork,
} from "@remit/data-ports";
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
 * Writes one calendar resource. Every caller that stores an event goes through
 * here — a REST handler, a DAV PUT, an accepted suggestion — because the object
 * row, its occurrence rows and the collection's sequence bump are one fact, and
 * a caller that writes any of them alone leaves the store describing a calendar
 * that does not exist.
 *
 * The bytes are stored exactly as given: parsing is for validating and
 * projecting them, never for rewriting them. Refusing the resource is a
 * returned value — the input is client-supplied, so malformed iCalendar is an
 * outcome the caller renders, not a fault.
 */
export const putCalendarObject = async (
	unitOfWork: ICalendarUnitOfWork,
	input: PutCalendarObjectInput,
): Promise<CalendarResult<CalendarObjectItem>> => {
	const parsed = await parseCalendar(input.icalData);
	if (!parsed.ok) return parsed;

	return unitOfWork.transaction(async (repos) => {
		const collection = await repos.calendarCollection.get(
			input.accountConfigId,
			input.calendarId,
		);

		const projection = projectCalendar(parsed.value, collection.timezone);
		if (!projection.ok) return projection;

		const expansion = expandCalendar(parsed.value, collection.timezone);
		const syncSequence = await repos.calendarCollection.bumpSyncSequence(
			input.accountConfigId,
			input.calendarId,
		);

		const object = await repos.calendarObject.put({
			...projection.value,
			calendarId: input.calendarId,
			resourceName: input.resourceName,
			icalData: input.icalData,
			etag: computeEtag(input.icalData),
			syncSequence,
			expandedThrough: expansion.expandedThrough,
		});

		await repos.calendarEventIndex.replaceForObject(
			input.calendarId,
			object.calendarObjectId,
			expansion.occurrences,
		);

		return { ok: true, value: object };
	});
};

/**
 * Removes a resource and the occurrences it produced, in one unit — an object
 * dropped without its occurrence rows leaves a calendar showing events no
 * resource backs, which nothing later can attribute or clean up.
 */
export const deleteCalendarObject = async (
	unitOfWork: ICalendarUnitOfWork,
	input: {
		accountConfigId: string;
		calendarId: string;
		calendarObjectId: string;
	},
): Promise<void> => {
	await unitOfWork.transaction(async (repos) => {
		await repos.calendarEventIndex.deleteForObject(
			input.calendarId,
			input.calendarObjectId,
		);
		await repos.calendarObject.delete(input.calendarId, input.calendarObjectId);
		await repos.calendarCollection.bumpSyncSequence(
			input.accountConfigId,
			input.calendarId,
		);
	});
};

/**
 * The collection an account config stores events in until someone makes
 * another. Safe to call on every request that needs a calendar: `calendarId` is
 * derived from the account config and the URL segment, so a second call returns
 * the collection the first one made rather than a rival copy of it.
 */
export const provisionDefaultCalendar = (
	unitOfWork: ICalendarUnitOfWork,
	accountConfigId: string,
	displayName = "Calendar",
): Promise<CalendarCollectionItem> =>
	unitOfWork.transaction((repos) =>
		repos.calendarCollection.create({
			accountConfigId,
			urlSegment: DEFAULT_CALENDAR_URL_SEGMENT,
			displayName,
			source: CalendarSource.Default,
		}),
	);
