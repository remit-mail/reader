/**
 * The weeks either side of the fixture week.
 *
 * A continuous strip cannot be judged on seven days: the argument for a list is
 * what happens when you keep scrolling, so the month around Wednesday 10 June
 * is filled in with the shape a real calendar has. Late May is thin, the two
 * weeks around the fixture week carry the weekday standup, and the run from
 * Saturday 20 June is genuinely empty because she is in Lisbon — the stay is
 * still sitting in the suggestions, unaccepted, so those days really do have
 * nothing booked on them.
 *
 * Nothing here edits the foundation's fixtures; `agendaEvents` is that list
 * plus these.
 */
import type { CalendarEventData } from "@remit/ui";
import {
	events as fixtureEvents,
	HOME_ZONE,
	hobbyCalendarId,
	personalCalendarId,
	travelCalendarId,
	workCalendarId,
} from "./calendar.js";

const OFFSET = "+02:00";

function at(date: string, clock: string): string {
	return `${date}T${clock}:00${OFFSET}`;
}

type Seed = Partial<CalendarEventData> &
	Pick<CalendarEventData, "id" | "calendarId" | "title" | "start" | "end">;

function event(seed: Seed): CalendarEventData {
	return {
		allDay: false,
		location: "",
		notes: "",
		attendees: [],
		myRsvp: "accepted",
		threadId: "",
		threadSubject: "",
		timeZone: HOME_ZONE,
		zoneCertainty: "local",
		recurrenceRule: "",
		seriesId: "",
		status: "confirmed",
		...seed,
	};
}

/** The weekdays the standup runs on outside the fixture week. */
const STANDUP_DAYS = [
	"2026-06-01",
	"2026-06-02",
	"2026-06-03",
	"2026-06-04",
	"2026-06-05",
	"2026-06-15",
	"2026-06-16",
	"2026-06-17",
	"2026-06-18",
	"2026-06-19",
	"2026-06-29",
	"2026-06-30",
	"2026-07-01",
];

const standups: CalendarEventData[] = STANDUP_DAYS.map((date) =>
	event({
		id: `evt_standup_${date}`,
		calendarId: workCalendarId,
		title: "Standup",
		start: at(date, "09:15"),
		end: at(date, "09:30"),
		location: "Huddle room / Meet",
		seriesId: "ser_standup",
		recurrenceRule: "Every weekday at 09:15",
	}),
);

const around: CalendarEventData[] = [
	/* --- Late May: thin, so scrolling back is not a wall ------------- */
	event({
		id: "evt_notary",
		calendarId: personalCalendarId,
		title: "Notary — mortgage papers",
		start: at("2026-05-28", "15:00"),
		end: at("2026-05-28", "16:00"),
		location: "Keizersgracht 62",
	}),
	event({
		id: "evt_texel",
		calendarId: personalCalendarId,
		title: "Weekend on Texel",
		start: "2026-05-30",
		end: "2026-06-01",
		allDay: true,
		location: "Den Hoorn",
	}),

	/* --- Week of 1 June --------------------------------------------- */
	event({
		id: "evt_sprint_planning",
		calendarId: workCalendarId,
		title: "Sprint planning",
		start: at("2026-06-01", "11:00"),
		end: at("2026-06-01", "12:00"),
		location: "Room Zuid",
	}),
	event({
		id: "evt_physio",
		calendarId: personalCalendarId,
		title: "Physio",
		start: at("2026-06-02", "08:00"),
		end: at("2026-06-02", "08:45"),
		location: "Fysio Westerpark",
	}),
	event({
		id: "evt_all_hands",
		calendarId: workCalendarId,
		title: "All-hands",
		start: at("2026-06-03", "16:00"),
		end: at("2026-06-03", "17:00"),
		location: "Kantine",
	}),
	event({
		id: "evt_dinner_mei",
		calendarId: personalCalendarId,
		title: "Dinner with Mei",
		start: at("2026-06-04", "19:00"),
		end: at("2026-06-04", "21:30"),
		location: "Rijsel",
		threadId: "thr_lopen",
		threadSubject: "Lunch walk Wednesday?",
	}),
	event({
		id: "evt_demo_5",
		calendarId: workCalendarId,
		title: "Demo",
		start: at("2026-06-05", "15:00"),
		end: at("2026-06-05", "16:00"),
		location: "Room Zuid",
	}),

	/* --- Week of 15 June: the last week before the trip -------------- */
	event({
		id: "evt_offsite_prep",
		calendarId: workCalendarId,
		title: "Offsite prep",
		start: at("2026-06-15", "13:00"),
		end: at("2026-06-15", "14:00"),
		location: "Meet",
		threadId: "thr_dana",
		threadSubject: "Offsite logistics — rooms, travel, the dinner",
	}),
	event({
		id: "evt_oncall_handover",
		calendarId: workCalendarId,
		title: "On-call handover to Ravi",
		start: at("2026-06-16", "09:00"),
		end: at("2026-06-16", "09:15"),
		location: "Meet",
	}),
	event({
		id: "evt_design_review",
		calendarId: workCalendarId,
		title: "Design review",
		start: at("2026-06-17", "10:00"),
		end: at("2026-06-17", "11:00"),
		location: "Studio",
	}),
	event({
		id: "evt_synth_meetup",
		calendarId: hobbyCalendarId,
		title: "Synth meetup — patch swap",
		start: at("2026-06-18", "19:00"),
		end: at("2026-06-18", "22:00"),
		location: "OT301",
	}),
	event({
		id: "evt_lisbon_flight",
		calendarId: travelCalendarId,
		title: "KL1691 Amsterdam → Lisbon",
		start: at("2026-06-19", "17:40"),
		end: at("2026-06-19", "20:05"),
		location: "Schiphol, gate D8",
		threadId: "thr_airbnb",
		threadSubject: "Your reservation in Lisbon is confirmed",
	}),

	/* --- 20 to 24 June: away, and nothing booked --------------------- */

	event({
		id: "evt_lisbon_return",
		calendarId: travelCalendarId,
		title: "TP664 Lisbon → Amsterdam",
		start: at("2026-06-25", "20:15"),
		end: at("2026-06-25", "23:00"),
		location: "Humberto Delgado, gate 22",
	}),
	event({
		id: "evt_jam_27",
		calendarId: hobbyCalendarId,
		title: "Modular jam night",
		start: at("2026-06-27", "20:00"),
		end: at("2026-06-27", "23:00"),
		location: "De Nieuwe Anita",
	}),
	event({
		id: "evt_back_catchup",
		calendarId: workCalendarId,
		title: "Catch-up with Priya",
		start: at("2026-06-29", "10:00"),
		end: at("2026-06-29", "10:30"),
		location: "Meet",
	}),
	event({
		id: "evt_q3_kickoff",
		calendarId: workCalendarId,
		title: "Q3 kickoff",
		start: at("2026-07-01", "09:30"),
		end: at("2026-07-01", "11:00"),
		location: "Room Zuid",
		threadId: "thr_q3",
		threadSubject: "Q3 roadmap review — agenda + pre-read",
	}),
];

/** The fixture week, plus the month around it. */
export const agendaEvents: CalendarEventData[] = [
	...fixtureEvents,
	...standups,
	...around,
];

/** The far ends of the strip, so the loader knows where to stop asking. */
export const STRIP_FIRST_DATE = "2026-05-01";
export const STRIP_LAST_DATE = "2026-07-31";
