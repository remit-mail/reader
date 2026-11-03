/**
 * The calendar the run starts with, and the clock the calendar specs read it
 * on. Every date is relative to the week the run happens in, so the grid a spec
 * opens on `/calendar/week/<this Monday>` always holds the seeded week.
 */
import {
	calendarEventOperationsCreateCalendarEvent,
	calendarOperationsCreateCalendar,
	calendarOperationsListCalendars,
} from "@remit/api-http-client";
import { ApiClient, type CreateCalendarEventInput } from "./api.js";
import { baseUrl } from "./env.js";
import { readRunState } from "./state.js";

export const CALENDAR_ZONE = "Europe/Amsterdam";

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * Today in Amsterdam as `YYYY-MM-DD`: the browser runs on that clock, so the
 * host's own date would name another day around midnight.
 */
export const today = (): string =>
	new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_ZONE }).format(
		new Date(),
	);

/** Monday of the week holding today in Amsterdam, plus a number of days. */
export const weekDay = (offset: number): string => {
	const date = new Date(`${today()}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + offset);
	return date.toISOString().slice(0, 10);
};

/** A wall-clock time in Amsterdam as an ISO string with its offset that day. */
export const amsterdam = (day: string, time: string): string => {
	const probe = new Date(`${day}T${time}:00Z`);
	const zoned = new Date(
		probe.toLocaleString("en-US", { timeZone: CALENDAR_ZONE }),
	);
	const utc = new Date(probe.toLocaleString("en-US", { timeZone: "UTC" }));
	const minutes = Math.round((zoned.getTime() - utc.getTime()) / 60000);
	const sign = minutes < 0 ? "-" : "+";
	const abs = Math.abs(minutes);
	return `${day}T${time}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

const SEEDED_CALENDARS = {
	work: { displayName: "Work", color: "Cal1" },
	personal: { displayName: "Personal", color: "Cal3" },
	team: { displayName: "Team", color: "Cal5" },
} as const;

type SeededSegment = keyof typeof SEEDED_CALENDARS;

const timed = (
	calendarId: string,
	summary: string,
	offset: number,
	start: string,
	end: string,
	extra: Partial<CreateCalendarEventInput> = {},
): CreateCalendarEventInput => ({
	calendarId,
	summary,
	start: amsterdam(weekDay(offset), start),
	end: amsterdam(weekDay(offset), end),
	timeZone: CALENDAR_ZONE,
	...extra,
});

const allDay = (
	calendarId: string,
	summary: string,
	offset: number,
	days: number,
): CreateCalendarEventInput => ({
	calendarId,
	summary,
	start: weekDay(offset),
	end: weekDay(offset + days),
	allDay: true,
});

const seededEvents = (
	ids: Record<SeededSegment, string>,
): CreateCalendarEventInput[] => {
	const { work, personal, team } = ids;
	const events: CreateCalendarEventInput[] = [];
	for (const week of [-7, 0, 7, 14]) {
		for (const weekday of [0, 1, 2, 3, 4])
			events.push(timed(work, "Standup", week + weekday, "09:30", "09:45"));
		events.push(
			timed(team, "Planning", week, "10:00", "11:30", { location: "Room 3" }),
			timed(personal, "Gym", week + 1, "18:00", "19:00"),
			timed(personal, "Gym", week + 3, "18:00", "19:00"),
		);
	}
	events.push(
		timed(work, "Design review: calendar", 1, "14:00", "15:00", {
			description: "Walk through the calendar rebuild on a phone.",
			location: "Video call",
		}),
		timed(work, "1:1", 2, "11:00", "11:30"),
		timed(team, "Overlapping sync A", 2, "13:00", "14:00"),
		timed(team, "Overlapping sync B", 2, "13:30", "14:30"),
		timed(personal, "Dinner with friends", 4, "19:30", "22:00", {
			location: "De Kas",
		}),
		timed(work, "Late deploy window", 3, "22:00", "23:30", {
			transparency: "Transparent",
		}),
		timed(team, "Offsite (tentative)", 9, "09:00", "17:00", {
			status: "Tentative",
		}),
		timed(work, "Cancelled retro", 4, "15:00", "16:00", {
			status: "Cancelled",
		}),
		allDay(personal, "Holiday", 5, 2),
		allDay(team, "Conference", 15, 3),
		allDay(work, "Release day", 3, 1),
	);
	return events;
};

/**
 * Three calendars and a month of ordinary weeks around this one, written with
 * the generated client the way any client would. The run's account is new, so
 * nothing here can already exist.
 */
export const seedCalendars = async (token: string): Promise<number> => {
	const options = {
		baseUrl: `${baseUrl}/api`,
		headers: { authorization: `Bearer ${token}`, origin: baseUrl },
		throwOnError: true,
	} as const;
	// The server provisions the default calendar on the first read of an
	// account that holds none, so the read comes before any create.
	await calendarOperationsListCalendars(options);
	const create = async (urlSegment: SeededSegment): Promise<string> => {
		const { data } = await calendarOperationsCreateCalendar({
			...options,
			body: {
				urlSegment,
				...SEEDED_CALENDARS[urlSegment],
				timezone: CALENDAR_ZONE,
			},
		});
		return data.calendarId;
	};
	const events = seededEvents({
		work: await create("work"),
		personal: await create("personal"),
		team: await create("team"),
	});
	for (const body of events)
		await calendarEventOperationsCreateCalendarEvent({ ...options, body });
	return events.length;
};

export const calendarIdOf = async (
	api: ApiClient,
	urlSegment: SeededSegment,
): Promise<string> => {
	const found = (await api.listCalendars()).find(
		(calendar) => calendar.urlSegment === urlSegment,
	);
	if (!found) throw new Error(`global setup seeded no ${urlSegment} calendar`);
	return found.calendarId;
};

/**
 * Removes every event a spec wrote under its prefix, over the weeks it uses.
 * Its own client, so a `beforeAll` or `afterAll` can call it.
 */
export const deleteEventsByPrefix = async (prefix: string): Promise<void> => {
	const api = new ApiClient(readRunState());
	const items = await api.listCalendarEvents(
		amsterdam(weekDay(-7), "00:00"),
		amsterdam(weekDay(42), "00:00"),
	);
	const doomed = new Map<string, string>();
	for (const item of items) {
		if (item.summary.startsWith(prefix))
			doomed.set(item.calendarObjectId, item.calendarId);
	}
	for (const [calendarObjectId, calendarId] of doomed)
		await api.deleteCalendarEvent(calendarObjectId, calendarId);
};
