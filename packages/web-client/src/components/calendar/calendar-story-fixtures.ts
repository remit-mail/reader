import type {
	RemitImapCalendarEventInstance,
	RemitImapCalendarEventResponse,
	RemitImapCalendarResponse,
} from "@remit/api-http-client/types.gen.ts";

/**
 * The synthetic account the calendar stories read.
 *
 * One collection, on a real zone, with occurrences spelled the way the listing
 * spells them. Nothing here is anybody's data: the ids are fixed strings and the
 * week is one the calendar will never be looking at by accident.
 */

export const WORK_CALENDAR = "11111111-1111-4111-8111-111111111111";
export const ROADMAP_OBJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const STANDUP_OBJECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const STANDUP_RECURRENCE = "2026-06-10T07:15:00Z";

export const STORY_DATE = "2026-06-10";
export const STORY_WEEK = `/calendar/week/${STORY_DATE}`;

export const calendars: RemitImapCalendarResponse[] = [
	{
		calendarId: WORK_CALENDAR,
		accountConfigId: "cfg-story",
		urlSegment: "work",
		displayName: "Northwind",
		color: "Cal1",
		componentSet: "VeventOnly",
		source: "UserCreated",
		timezone: "Europe/Amsterdam",
		syncSequence: 1,
		createdAt: 0,
		updatedAt: 0,
	} as RemitImapCalendarResponse,
];

const template = {
	calendarId: WORK_CALENDAR,
	calendarObjectId: ROADMAP_OBJECT,
	recurrenceId: "",
	icalUid: "uid-roadmap",
	summary: "",
	start: "",
	end: "",
	allDay: false,
	status: "Confirmed",
	transparency: "Opaque",
	zoneCertainty: "Explicit",
	etag: "etag-1",
	hasRecurrence: false,
} as RemitImapCalendarEventInstance;

const at = (
	summary: string,
	day: string,
	from: string,
	to: string,
	over: Partial<RemitImapCalendarEventInstance> = {},
): RemitImapCalendarEventInstance =>
	({
		...template,
		...over,
		summary,
		start: `2026-06-${day}T${from}:00+02:00`,
		end: `2026-06-${day}T${to}:00+02:00`,
	}) as RemitImapCalendarEventInstance;

export const roadmap = at("Roadmap review", "10", "10:00", "11:30");

export const standup = at("Standup", "10", "09:15", "09:30", {
	calendarObjectId: STANDUP_OBJECT,
	icalUid: "uid-standup",
	recurrenceId: STANDUP_RECURRENCE,
	hasRecurrence: true,
});

/** A fortnight that is mostly empty, which is what a real fortnight looks like. */
export const fortnight: RemitImapCalendarEventInstance[] = [
	standup,
	roadmap,
	at("Dentist", "11", "11:00", "12:00", { icalUid: "uid-dentist" }),
	at("Retro", "18", "16:00", "17:00", { icalUid: "uid-retro" }),
];

export const roadmapResource = {
	calendarObjectId: ROADMAP_OBJECT,
	calendarId: WORK_CALENDAR,
	resourceName: "roadmap.ics",
	icalUid: "uid-roadmap",
	icalData: [
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT",
		"SUMMARY:Roadmap review",
		"LOCATION:Room Zuid",
		"DESCRIPTION:Bring the staffing numbers.",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n"),
	etag: "etag-1",
} as RemitImapCalendarEventResponse;

export const standupResource = {
	...roadmapResource,
	calendarObjectId: STANDUP_OBJECT,
	resourceName: "standup.ics",
	icalUid: "uid-standup",
	icalData: [
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT",
		"SUMMARY:Standup",
		"RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n"),
} as RemitImapCalendarEventResponse;

/**
 * The occurrences inside the window a request asked for.
 *
 * The panes read a week at a time and hold several weeks at once, so a server
 * that answered every window with the same list would draw each day's events
 * once per window it appears in.
 */
export const instancesWithin = (
	url: URL,
	instances: readonly RemitImapCalendarEventInstance[],
): RemitImapCalendarEventInstance[] => {
	const from = Date.parse(url.searchParams.get("from") ?? "");
	const to = Date.parse(url.searchParams.get("to") ?? "");
	if (Number.isNaN(from) || Number.isNaN(to)) return [...instances];
	return instances.filter((instance) => {
		const start = Date.parse(instance.start);
		return start >= from && start < to;
	});
};
