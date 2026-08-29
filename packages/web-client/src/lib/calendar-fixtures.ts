/**
 * A week of invented calendar, so the routes and the grid can be walked before
 * the REST layer exists. Every name here is made up and every event is
 * generated from the day being looked at, which is what keeps the grid full
 * wherever the reader navigates instead of only in June 2026.
 *
 * Stage A.3 deletes this file: `hooks/useCalendarData` swaps its body for the
 * query hooks and nothing that renders a calendar changes.
 */
import type {
	CalendarColorId,
	CalendarDescriptor,
	CalendarEventData,
} from "@remit/ui";

export const workCalendarId = "fixture-work";
export const personalCalendarId = "fixture-personal";
export const teamCalendarId = "fixture-team";

export const fixtureCalendars: CalendarDescriptor[] = [
	{
		id: workCalendarId,
		accountId: "fixture-account-work",
		accountLabel: "Work",
		name: "Work",
		color: "cal-1",
	},
	{
		id: teamCalendarId,
		accountId: "fixture-account-work",
		accountLabel: "Work",
		name: "Team",
		color: "cal-6",
	},
	{
		id: personalCalendarId,
		accountId: "fixture-account-personal",
		accountLabel: "Personal",
		name: "Personal",
		color: "cal-4",
	},
];

export const fixtureColorByCalendarId: Record<string, CalendarColorId> =
	Object.fromEntries(
		fixtureCalendars.map((calendar) => [calendar.id, calendar.color]),
	);

const pad = (value: number): string => String(value).padStart(2, "0");

/** The Monday of the week a day falls in; the grid starts its weeks there. */
function weekStart(date: string): Date {
	const [year, month, day] = date.split("-").map(Number);
	const instant = new Date(Date.UTC(year, month - 1, day));
	const weekday = (instant.getUTCDay() + 6) % 7;
	instant.setUTCDate(instant.getUTCDate() - weekday);
	return instant;
}

function dayOffsetFrom(start: Date, days: number): string {
	const instant = new Date(start);
	instant.setUTCDate(instant.getUTCDate() + days);
	return `${instant.getUTCFullYear()}-${pad(instant.getUTCMonth() + 1)}-${pad(
		instant.getUTCDate(),
	)}`;
}

/** The zone the device is on, which is the only clock a fixture can honestly use. */
export const fixtureTimeZone = (): string =>
	Intl.DateTimeFormat().resolvedOptions().timeZone;

/** An ISO instant carrying the device's own offset for that day. */
function at(date: string, hour: number, minute: number): string {
	const local = new Date(`${date}T${pad(hour)}:${pad(minute)}:00`);
	const offset = -local.getTimezoneOffset();
	const sign = offset < 0 ? "-" : "+";
	const size = Math.abs(offset);
	return `${date}T${pad(hour)}:${pad(minute)}:00${sign}${pad(
		Math.floor(size / 60),
	)}:${pad(size % 60)}`;
}

const template: CalendarEventData = {
	id: "",
	calendarId: workCalendarId,
	title: "",
	start: "",
	end: "",
	allDay: false,
	location: "",
	notes: "",
	attendees: [],
	myRsvp: "accepted",
	threadId: "",
	threadSubject: "",
	timeZone: "",
	zoneCertainty: "explicit",
	recurrenceRule: "",
	seriesId: "",
	seriesException: false,
	status: "confirmed",
};

interface FixtureSpec {
	dayOffset: number;
	startHour: number;
	startMinute: number;
	endHour: number;
	endMinute: number;
	title: string;
	calendarId: string;
	location: string;
	recurrenceRule: string;
	seriesId: string;
}

const spec = (
	dayOffset: number,
	title: string,
	startHour: number,
	endHour: number,
	over: Partial<FixtureSpec> = {},
): FixtureSpec => ({
	dayOffset,
	startHour,
	startMinute: 0,
	endHour,
	endMinute: 0,
	title,
	calendarId: workCalendarId,
	location: "",
	recurrenceRule: "",
	seriesId: "",
	...over,
});

/**
 * One made-up week: a daily standup, a couple of long blocks, an overlap on
 * Wednesday and something on a Saturday, so every band the grid draws has
 * something in it.
 */
const WEEK: FixtureSpec[] = [
	spec(0, "Standup", 9, 9, {
		startMinute: 15,
		endMinute: 30,
		recurrenceRule: "Every weekday, 09:15",
		seriesId: "fixture-standup",
	}),
	spec(0, "Roadmap review", 11, 12, { calendarId: teamCalendarId }),
	spec(1, "Standup", 9, 9, {
		startMinute: 15,
		endMinute: 30,
		recurrenceRule: "Every weekday, 09:15",
		seriesId: "fixture-standup",
	}),
	spec(1, "Supplier call", 14, 15, {
		calendarId: teamCalendarId,
		location: "Meet",
	}),
	spec(2, "Standup", 9, 9, {
		startMinute: 15,
		endMinute: 30,
		recurrenceRule: "Every weekday, 09:15",
		seriesId: "fixture-standup",
	}),
	spec(2, "Design review", 10, 12, { calendarId: teamCalendarId }),
	spec(2, "Dentist", 11, 12, {
		calendarId: personalCalendarId,
		location: "Kerkstraat 4",
	}),
	spec(3, "Standup", 9, 9, {
		startMinute: 15,
		endMinute: 30,
		recurrenceRule: "Every weekday, 09:15",
		seriesId: "fixture-standup",
	}),
	spec(3, "One to one", 15, 16, { location: "Room 2" }),
	spec(4, "Standup", 9, 9, {
		startMinute: 15,
		endMinute: 30,
		recurrenceRule: "Every weekday, 09:15",
		seriesId: "fixture-standup",
	}),
	spec(4, "Retro", 16, 17, { calendarId: teamCalendarId }),
	spec(5, "Climbing", 10, 12, { calendarId: personalCalendarId }),
];

/** The invented week around a day, in the zone the device is running on. */
export function fixtureEventsAround(date: string): CalendarEventData[] {
	const start = weekStart(date);
	const timeZone = fixtureTimeZone();
	return WEEK.map((entry) => {
		const day = dayOffsetFrom(start, entry.dayOffset);
		return {
			...template,
			id: `fixture-${day}-${entry.title.toLowerCase().replace(/\s+/g, "-")}`,
			calendarId: entry.calendarId,
			title: entry.title,
			start: at(day, entry.startHour, entry.startMinute),
			end: at(day, entry.endHour, entry.endMinute),
			location: entry.location,
			timeZone,
			recurrenceRule: entry.recurrenceRule,
			seriesId: entry.seriesId,
		};
	});
}
