import type {
	CalendarAttendee,
	CalendarDescriptor,
	CalendarEventData,
	EventSuggestion,
	ThreadData,
} from "@remit/ui";
import { wallSpanOn } from "../lib/agenda-time.js";
import {
	allThreads,
	hobbyId,
	lisbonCallThread,
	personalId,
	q3Thread,
	workId,
} from "./workspace.js";

/**
 * One week of calendar, on the same three accounts and the same fixed "now" as
 * the mail fixtures — Wednesday 10 June 2026, 09:30 in Amsterdam. The week is
 * built to make the hard cases visible rather than to look tidy: a quiet
 * Monday against a Wednesday with five events on top of each other, a chain of
 * back-to-backs, a stay that spans three days, two all-day entries, a call
 * anchored in another zone, and one event whose zone the mail never gave. Three
 * series run through it — a weekday standup, a weekly 1:1, a monthly review —
 * and one standup has been moved out of line, so the difference between a series
 * and an instance of it is on screen rather than only in the type.
 *
 * Every event that came out of a thread carries that thread's real id from
 * `workspace.ts`, so the link back to mail resolves to a message that exists.
 * Suggestions are kept in their own list and their own type: they are readings
 * of mail, not events, and nothing here promotes one without a person saying so.
 */

/** Alice's own zone; June puts Amsterdam at UTC+2. */
export const HOME_ZONE = "Europe/Amsterdam";
const OFFSET = "+02:00";

/** The Wednesday every relative label in this file is measured from. */
export const TODAY = "2026-06-10";
export const NOW_ISO = `${TODAY}T09:30:00${OFFSET}`;

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

/** June day of month → ISO date. The whole fixture lives inside one month. */
function day(dayOfMonth: number): string {
	return `2026-06-${pad(dayOfMonth)}`;
}

function at(dayOfMonth: number, hour: number, minute = 0): string {
	return `${day(dayOfMonth)}T${pad(hour)}:${pad(minute)}:00${OFFSET}`;
}

/* ------------------------------------------------------------------ */
/* Calendars — six, across the three mail accounts                     */
/* ------------------------------------------------------------------ */

export const workCalendarId = "cal_work";
export const oncallCalendarId = "cal_oncall";
export const personalCalendarId = "cal_personal";
export const familyCalendarId = "cal_family";
export const travelCalendarId = "cal_travel";
export const hobbyCalendarId = "cal_hobby";

export const calendars: CalendarDescriptor[] = [
	{
		id: workCalendarId,
		accountId: workId,
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-1",
	},
	{
		id: oncallCalendarId,
		accountId: workId,
		accountLabel: "Work",
		name: "On-call",
		color: "cal-4",
	},
	{
		id: personalCalendarId,
		accountId: personalId,
		accountLabel: "Personal",
		name: "Personal",
		color: "cal-2",
	},
	{
		id: familyCalendarId,
		accountId: personalId,
		accountLabel: "Personal",
		name: "Family",
		color: "cal-3",
	},
	{
		id: travelCalendarId,
		accountId: personalId,
		accountLabel: "Personal",
		name: "Travel",
		color: "cal-6",
	},
	{
		id: hobbyCalendarId,
		accountId: hobbyId,
		accountLabel: "Synthwave Forum",
		name: "Synth meetups",
		color: "cal-5",
	},
];

export const calendarsById = new Map(calendars.map((c) => [c.id, c]));

export const allCalendarIds: string[] = calendars.map((c) => c.id);

/* ------------------------------------------------------------------ */
/* People — reusing the sender identities from the mail fixtures       */
/* ------------------------------------------------------------------ */

function guest(
	name: string,
	email: string,
	rsvp: CalendarAttendee["rsvp"],
	role: CalendarAttendee["role"] = "attendee",
): CalendarAttendee {
	return { name, email, rsvp, role };
}

const priya = (
	rsvp: CalendarAttendee["rsvp"],
	role?: CalendarAttendee["role"],
) => guest("Priya Natarajan", "priya@northwind.example", rsvp, role);
const marcus = (
	rsvp: CalendarAttendee["rsvp"],
	role?: CalendarAttendee["role"],
) => guest("Marcus Webb", "marcus@northwind.example", rsvp, role);
const dana = (
	rsvp: CalendarAttendee["rsvp"],
	role?: CalendarAttendee["role"],
) => guest("Dana Okafor", "dana@northwind.example", rsvp, role);
const sven = (
	rsvp: CalendarAttendee["rsvp"],
	role?: CalendarAttendee["role"],
) => guest("Sven Larsen", "sven@northwind.example", rsvp, role);
const aisha = (
	rsvp: CalendarAttendee["rsvp"],
	role?: CalendarAttendee["role"],
) => guest("Aisha Khan", "aisha@northwind.example", rsvp, role);
const ravi = (
	rsvp: CalendarAttendee["rsvp"],
	role?: CalendarAttendee["role"],
) => guest("Ravi Mehta", "ravi@northwind.example", rsvp, role);
const carmen = (
	rsvp: CalendarAttendee["rsvp"],
	role?: CalendarAttendee["role"],
) => guest("Carmen Diaz", "carmen@northwind.example", rsvp, role);
const sofia = (
	rsvp: CalendarAttendee["rsvp"],
	role?: CalendarAttendee["role"],
) => guest("Sofia Lindgren", "sofia@partnerco.example", rsvp, role);
const mei = (rsvp: CalendarAttendee["rsvp"], role?: CalendarAttendee["role"]) =>
	guest("Mei Tan", "mei.tan@gmail.example", rsvp, role);

/* ------------------------------------------------------------------ */
/* The week                                                            */
/* ------------------------------------------------------------------ */

type EventSeed = Partial<CalendarEventData> &
	Pick<CalendarEventData, "id" | "calendarId" | "title" | "start" | "end">;

function event(seed: EventSeed): CalendarEventData {
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
		seriesException: false,
		status: "confirmed",
		...seed,
	};
}

/** The three series the week runs on, in the words the detail pane reads back. */
export const STANDUP_RULE = "Every weekday, 09:15";
export const ONE_TO_ONE_RULE = "Every week on Monday, 14:00";
export const MONTHLY_REVIEW_RULE = "Every month on the second Wednesday, 16:00";

export const STANDUP_SERIES_ID = "ser_standup";
export const ONE_TO_ONE_SERIES_ID = "ser_marcus_1to1";
export const MONTHLY_REVIEW_SERIES_ID = "ser_monthly_review";

/**
 * The weekday standup: one series, five instances, and Thursday moved out of
 * line. An exception is the case a series design lives or dies on, so the week
 * carries one rather than five identical mornings.
 */
const standups: CalendarEventData[] = [8, 9, 10, 11, 12].map((d) => {
	const moved = d === 11;
	return event({
		id: `evt_standup_${d}`,
		calendarId: workCalendarId,
		title: "Standup",
		start: moved ? at(d, 10, 30) : at(d, 9, 15),
		end: moved ? at(d, 10, 45) : at(d, 9, 30),
		location: moved ? "Meet" : "Huddle room / Meet",
		seriesId: STANDUP_SERIES_ID,
		seriesException: moved,
		recurrenceRule: STANDUP_RULE,
		notes: moved
			? "Pushed an hour and a quarter for the offsite travel window. The rest of the week is unchanged."
			: "",
		attendees: [
			priya("accepted", "organizer"),
			marcus("accepted"),
			dana("accepted"),
			ravi("noReply"),
		],
	});
});

export const events: CalendarEventData[] = [
	...standups,

	/* --- Monday 8th: the quiet day --------------------------------- */
	event({
		id: "evt_marcus_1to1",
		calendarId: workCalendarId,
		title: "1:1 with Marcus",
		start: at(8, 14),
		end: at(8, 14, 30),
		location: "Walk around the park",
		threadId: "thr_marcus",
		threadSubject: "Re: Reading pane density — a vote for calmer",
		seriesId: ONE_TO_ONE_SERIES_ID,
		recurrenceRule: ONE_TO_ONE_RULE,
		attendees: [marcus("accepted", "organizer")],
	}),
	event({
		id: "evt_modular_jam",
		calendarId: hobbyCalendarId,
		title: "Modular jam night",
		start: at(8, 20),
		end: at(8, 23),
		location: "De Nieuwe Anita",
		notes: "Bring the Juno and a spare patch cable.",
	}),

	/* --- Tuesday 9th: back to back --------------------------------- */
	event({
		id: "evt_platform_sync",
		calendarId: workCalendarId,
		title: "Platform sync",
		start: at(9, 10),
		end: at(9, 11),
		location: "Room Zuid",
		attendees: [ravi("accepted", "organizer"), aisha("accepted")],
	}),
	event({
		id: "evt_partner_review",
		calendarId: workCalendarId,
		title: "PartnerCo review",
		start: at(9, 11),
		end: at(9, 12),
		location: "Meet",
		attendees: [sofia("accepted", "organizer"), priya("tentative")],
	}),
	event({
		id: "evt_lunch_carmen",
		calendarId: workCalendarId,
		title: "Lunch with Carmen",
		start: at(9, 12),
		end: at(9, 12, 45),
		location: "Canteen",
		attendees: [carmen("accepted", "organizer")],
	}),
	event({
		id: "evt_sprint_retro",
		calendarId: workCalendarId,
		title: "Sprint retro",
		start: at(9, 13),
		end: at(9, 14),
		location: "Room Noord",
		threadId: "thr_retro",
		threadSubject: "Sprint retro notes assigned to you: 2 follow-ups",
		attendees: [
			dana("accepted", "organizer"),
			marcus("accepted"),
			ravi("declined"),
		],
	}),
	event({
		id: "evt_oncall_start",
		calendarId: oncallCalendarId,
		title: "On-call: primary",
		start: day(9),
		end: day(16),
		allDay: true,
		notes: "Handover at 09:00 Tuesday, back to Ravi the following Tuesday.",
	}),

	/* --- Wednesday 10th: the brutal day ---------------------------- */
	event({
		id: "evt_portugal_day",
		calendarId: workCalendarId,
		title: "Portugal Day — Lisbon office closed",
		start: day(10),
		end: day(11),
		allDay: true,
	}),
	event({
		id: "evt_q3_roadmap",
		calendarId: workCalendarId,
		title: "Q3 roadmap review",
		start: at(10, 10),
		end: at(10, 11, 30),
		location: "Room Zuid",
		threadId: "thr_q3",
		threadSubject: "Q3 roadmap review — agenda + pre-read",
		attendees: [
			priya("accepted", "organizer"),
			marcus("accepted"),
			dana("tentative"),
			aisha("noReply"),
			sven("declined"),
		],
	}),
	event({
		id: "evt_incident_review",
		calendarId: workCalendarId,
		title: "Incident review: IMAP latency",
		start: at(10, 10),
		end: at(10, 11),
		location: "Meet",
		threadId: "thr_incident",
		threadSubject: "[resolved] Elevated IMAP sync latency eu-west-1",
		attendees: [ravi("accepted", "organizer"), aisha("accepted")],
	}),
	event({
		id: "evt_design_crit",
		calendarId: workCalendarId,
		title: "Design crit",
		start: at(10, 10, 15),
		end: at(10, 11, 15),
		location: "Studio",
		attendees: [marcus("accepted", "organizer"), carmen("tentative")],
	}),
	event({
		id: "evt_staff_screen",
		calendarId: workCalendarId,
		title: "Staff engineer screen",
		start: at(10, 10, 30),
		end: at(10, 11),
		location: "Meet",
		threadId: "thr_sven",
		threadSubject: "Interview debrief — staff engineer loop",
		myRsvp: "tentative",
		attendees: [sven("accepted", "organizer")],
		status: "tentative",
	}),
	event({
		id: "evt_vendor_call",
		calendarId: workCalendarId,
		title: "Vendor call: object storage",
		start: at(10, 10, 45),
		end: at(10, 11, 45),
		location: "Phone",
		myRsvp: "noReply",
		attendees: [sofia("noReply", "organizer")],
	}),
	event({
		id: "evt_lunch_walk",
		calendarId: personalCalendarId,
		title: "Lunch walk",
		start: at(10, 12, 30),
		end: at(10, 13, 15),
		location: "Westerpark",
		threadId: "thr_lopen",
		threadSubject: "Lunch walk Wednesday?",
		attendees: [mei("accepted", "organizer")],
	}),
	event({
		id: "evt_monthly_review",
		calendarId: workCalendarId,
		title: "Monthly business review",
		start: at(10, 16),
		end: at(10, 17),
		location: "Room Noord",
		seriesId: MONTHLY_REVIEW_SERIES_ID,
		recurrenceRule: MONTHLY_REVIEW_RULE,
		attendees: [
			priya("accepted", "organizer"),
			dana("accepted"),
			sven("tentative"),
		],
	}),
	event({
		id: "evt_sf_sync",
		calendarId: workCalendarId,
		title: "Sync with the SF team",
		start: at(10, 18),
		end: at(10, 18, 45),
		location: "Meet",
		timeZone: "America/Los_Angeles",
		zoneCertainty: "explicit",
		notes: "09:00 for them. Set by their calendar, not ours.",
		attendees: [aisha("accepted", "organizer")],
	}),

	/* --- Thursday 11th --------------------------------------------- */
	event({
		id: "evt_dentist",
		calendarId: personalCalendarId,
		title: "Tandarts",
		start: at(11, 14, 15),
		end: at(11, 15),
		location: "Tandartspraktijk Jordaan",
		threadId: "thr_dentist",
		threadSubject: "Herinnering: afspraak donderdag 11 juni, 14:15",
	}),
	event({
		id: "evt_aws_meetup",
		calendarId: personalCalendarId,
		title: "AWS User Group Amsterdam",
		start: at(11, 18, 30),
		end: at(11, 21),
		location: "Startup Village",
		threadId: "thr_meetup",
		threadSubject: "AWS User Group Amsterdam meets Thursday",
		myRsvp: "declined",
		status: "tentative",
	}),
	event({
		id: "evt_offsite_dinner",
		calendarId: workCalendarId,
		title: "Offsite dinner",
		start: at(11, 19),
		end: at(11, 22),
		location: "Toscanini",
		threadId: "thr_dana",
		threadSubject: "Offsite logistics — rooms, travel, the dinner",
		timeZone: "",
		zoneCertainty: "ambiguous",
		notes: 'The thread says "dinner at 7" and never says where anyone is.',
		attendees: [
			dana("accepted", "organizer"),
			priya("accepted"),
			marcus("noReply"),
		],
	}),

	/* --- Friday 12th ----------------------------------------------- */
	event({
		id: "evt_mum_birthday",
		calendarId: familyCalendarId,
		title: "Mum's birthday",
		start: day(12),
		end: day(13),
		allDay: true,
		threadId: "thr_mom",
		threadSubject: "Sunday lunch?",
	}),
	event({
		id: "evt_weekender",
		calendarId: hobbyCalendarId,
		title: "Synthwave Weekender",
		start: day(12),
		end: day(15),
		allDay: true,
		location: "Utrecht",
		notes: "Three days. Friday evening through Sunday.",
	}),
	event({
		id: "evt_demo",
		calendarId: workCalendarId,
		title: "Demo",
		start: at(12, 15),
		end: at(12, 16),
		location: "Room Zuid",
		attendees: [
			priya("accepted", "organizer"),
			dana("accepted"),
			sven("tentative"),
		],
	}),

	/* --- Weekend ---------------------------------------------------- */
	event({
		id: "evt_family_lunch",
		calendarId: familyCalendarId,
		title: "Lunch at Mum's",
		start: at(14, 13),
		end: at(14, 15, 30),
		location: "Haarlem",
		threadId: "thr_mom",
		threadSubject: "Sunday lunch?",
	}),
];

/* ------------------------------------------------------------------ */
/* Suggestions — read out of mail, not on the grid                     */
/* ------------------------------------------------------------------ */

export const suggestions: EventSuggestion[] = [
	{
		id: "sug_lisbon_call",
		title: "Kickoff call — Lisbon venue",
		/**
		 * The hour the mail printed, on an offset that is a placeholder: which
		 * clock it is on is exactly what nobody stated, so nothing may be read
		 * off this until a zone is picked.
		 */
		start: at(17, 16),
		end: at(17, 17),
		allDay: false,
		location: "Meet link",
		threadId: "thr_lisbon_call",
		threadSubject: "Kickoff call on Wednesday at 16:00",
		sender: "Rita Sousa",
		confidence: 0.66,
		ambiguity:
			"Rita writes from Lisbon and names 16:00 without a clock. Lisbon runs an hour behind Amsterdam, so this is either 16:00 or 17:00 for you.",
		suggestedCalendarId: workCalendarId,
		timeZone: "",
		zoneCertainty: "ambiguous",
		zoneOptions: [
			{
				timeZone: "Europe/Lisbon",
				label: "16:00 in Lisbon",
				note: "17:00 on your own clock. The hour she keeps.",
			},
			{
				timeZone: HOME_ZONE,
				label: "16:00 in Amsterdam",
				note: "15:00 where she is.",
			},
		],
	},
	{
		id: "sug_lisbon_stay",
		title: "Stay in Lisbon",
		start: day(19),
		end: day(23),
		allDay: true,
		location: "Alfama, Lisbon",
		threadId: "thr_airbnb",
		threadSubject: "Your reservation in Lisbon is confirmed",
		sender: "Airbnb",
		senderAddress: "automated@airbnb.example",
		confidence: 0.94,
		ambiguity: "",
		suggestedCalendarId: travelCalendarId,
		timeZone: "Europe/Lisbon",
		zoneCertainty: "explicit",
	},
	{
		id: "sug_toscanini",
		title: "Table for six at Toscanini",
		start: at(19, 19, 30),
		end: at(19, 22),
		allDay: false,
		location: "Toscanini, Lindengracht",
		threadId: "thr_dana",
		threadSubject: "Offsite logistics — rooms, travel, the dinner",
		sender: "Dana Okafor",
		senderAddress: "dana@northwind.example",
		confidence: 0.71,
		ambiguity:
			'The thread says "the Friday after the offsite" — read as 19 June.',
		suggestedCalendarId: personalCalendarId,
		timeZone: HOME_ZONE,
		zoneCertainty: "local",
	},
	{
		id: "sug_analytics_pilot",
		title: "Analytics pilot — first call",
		start: at(16, 9),
		end: at(16, 10),
		allDay: false,
		location: "",
		threadId: "thr_wahlberg",
		threadSubject: "Following up: analytics pilot proposal",
		sender: "Erik Wahlberg",
		senderAddress: "erik@vendor-analytics.example",
		confidence: 0.38,
		ambiguity:
			'Asked for "some time Tuesday" and named no hour. Two Tuesdays fit.',
		suggestedCalendarId: workCalendarId,
		timeZone: HOME_ZONE,
		zoneCertainty: "ambiguous",
	},
	{
		id: "sug_meetup_talk",
		title: "AWS meetup — lightning talk slot",
		start: at(18, 19),
		end: at(18, 19, 20),
		allDay: false,
		location: "Startup Village",
		threadId: "thr_meetup",
		threadSubject: "AWS User Group Amsterdam meets Thursday",
		sender: "AWS User Group Amsterdam",
		senderAddress: "announce@awsug-amsterdam.example",
		confidence: 0.55,
		ambiguity: 'Says "Thursday" in a mail sent on a Thursday.',
		suggestedCalendarId: personalCalendarId,
		timeZone: HOME_ZONE,
		zoneCertainty: "local",
	},
];

/* ------------------------------------------------------------------ */
/* Derived — computed from the week above, never restated by hand      */
/* ------------------------------------------------------------------ */

export interface CalendarDay {
	/** `YYYY-MM-DD`. */
	date: string;
	weekdayLabel: string;
	dayNumber: number;
	isToday: boolean;
	timed: CalendarEventData[];
	allDay: CalendarEventData[];
	/** Minutes of the day covered by at least one timed event. */
	busyMinutes: number;
	/**
	 * Every pile-up on the day: one group per event that something else runs
	 * into, holding that event and everything overlapping it. Members all meet
	 * the event the group is built around, not necessarily each other — which is
	 * what a grid has to lay out. Empty when the day is clean.
	 */
	conflicts: string[][];
}

function ms(iso: string): number {
	return new Date(iso).getTime();
}

/** An all-day range ends on the morning after its last day. */
function coversDay(event: CalendarEventData, date: string): boolean {
	if (!event.allDay) return event.start.slice(0, 10) === date;
	return date >= event.start.slice(0, 10) && date < event.end.slice(0, 10);
}

function overlaps(a: CalendarEventData, b: CalendarEventData): boolean {
	return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
}

export function busyMinutesOf(timed: CalendarEventData[]): number {
	const spans = timed
		.map((e) => [ms(e.start), ms(e.end)] as const)
		.sort((a, b) => a[0] - b[0]);
	let covered = 0;
	let openFrom = 0;
	let openTo = 0;
	for (const [from, to] of spans) {
		if (from > openTo) {
			covered += openTo - openFrom;
			openFrom = from;
			openTo = to;
			continue;
		}
		openTo = Math.max(openTo, to);
	}
	covered += openTo - openFrom;
	return Math.round(covered / 60_000);
}

/** Every event that runs into another, grouped around the one it collides with. */
export function conflictsOf(timed: CalendarEventData[]): string[][] {
	const groups: string[][] = [];
	for (const anchor of timed) {
		const group = timed
			.filter((other) => other.id === anchor.id || overlaps(anchor, other))
			.map((e) => e.id)
			.sort();
		if (group.length < 2) continue;
		const key = group.join("|");
		if (!groups.some((existing) => existing.join("|") === key))
			groups.push(group);
	}
	return groups.filter(
		(group) =>
			!groups.some(
				(other) => other !== group && group.every((id) => other.includes(id)),
			),
	);
}

function weekdayLabel(date: string): string {
	const [year, month, dayOfMonth] = date.split("-").map(Number);
	return new Date(year, month - 1, dayOfMonth).toLocaleDateString("en-GB", {
		weekday: "short",
	});
}

export function buildDay(date: string, source = events): CalendarDay {
	const onDay = source.filter((e) => coversDay(e, date));
	const timed = onDay
		.filter((e) => !e.allDay)
		.sort((a, b) => ms(a.start) - ms(b.start));
	return {
		date,
		weekdayLabel: weekdayLabel(date),
		dayNumber: Number(date.slice(8)),
		isToday: date === TODAY,
		timed,
		allDay: onDay.filter((e) => e.allDay),
		busyMinutes: busyMinutesOf(timed),
		conflicts: conflictsOf(timed),
	};
}

/** Monday through Sunday of the fixture week, computed off `events`. */
export const week: CalendarDay[] = [8, 9, 10, 11, 12, 13, 14].map((d) =>
	buildDay(day(d)),
);

/** How many events sit on top of one another in this day's worst moment. */
function deepestPile(day: CalendarDay): number {
	return day.conflicts.reduce(
		(deepest, group) => Math.max(deepest, group.length),
		0,
	);
}

/** The day the overlap rule has to survive — the tallest stack, not the most. */
export const mostOverlappedDay: CalendarDay = week.reduce((worst, candidate) =>
	deepestPile(candidate) > deepestPile(worst) ? candidate : worst,
);

/** The day that shows what the same design looks like with room to breathe. */
export const quietestDay: CalendarDay = week
	.filter((d) => d.timed.length > 0)
	.reduce((best, candidate) =>
		candidate.busyMinutes < best.busyMinutes ? candidate : best,
	);

/* ------------------------------------------------------------------ */
/* Formatting the stories share                                        */
/* ------------------------------------------------------------------ */

export function formatClock(iso: string): string {
	return iso.slice(11, 16);
}

export function formatDayLabel(date: string): string {
	const [year, month, dayOfMonth] = date.split("-").map(Number);
	return new Date(year, month - 1, dayOfMonth).toLocaleDateString("en-GB", {
		weekday: "long",
		day: "numeric",
		month: "long",
	});
}

/** "Wednesday 10 June · 10:00 – 11:30", or the all-day span. */
export function formatEventWhen(event: CalendarEventData): string {
	if (event.allDay) {
		const first = event.start.slice(0, 10);
		const lastDay = new Date(`${event.end.slice(0, 10)}T00:00:00Z`);
		lastDay.setUTCDate(lastDay.getUTCDate() - 1);
		const last = lastDay.toISOString().slice(0, 10);
		return first === last
			? `${formatDayLabel(first)} · all day`
			: `${formatDayLabel(first)} – ${formatDayLabel(last)}`;
	}
	return `${formatDayLabel(event.start.slice(0, 10))} · ${formatClock(
		event.start,
	)} – ${formatClock(event.end)}`;
}

export function formatSuggestionWhen(suggestion: EventSuggestion): string {
	if (suggestion.allDay) {
		const lastDay = new Date(`${suggestion.end.slice(0, 10)}T00:00:00Z`);
		lastDay.setUTCDate(lastDay.getUTCDate() - 1);
		return `${formatDayLabel(suggestion.start.slice(0, 10))} – ${formatDayLabel(
			lastDay.toISOString().slice(0, 10),
		)}`;
	}
	return `${formatDayLabel(suggestion.start.slice(0, 10))} · ${formatClock(
		suggestion.start,
	)} – ${formatClock(suggestion.end)}`;
}

/**
 * The mail an event or a suggestion came out of. Every calendar `threadId` is a
 * real row in `workspace.ts`, so the way back always resolves; the roadmap
 * thread has a written-out conversation and the rest open on their one message.
 */
export function threadFor(threadId: string): ThreadData | undefined {
	if (threadId === "") return undefined;
	if (threadId === "thr_q3") return q3Thread;
	if (threadId === "thr_lisbon_call") return lisbonCallThread;
	const row = allThreads.find((candidate) => candidate.id === threadId);
	if (!row) return undefined;
	return {
		subject: row.subject,
		messages: [
			{
				id: `msg_${row.id}`,
				fromName: row.fromName,
				fromEmail: row.fromEmail,
				toLabel: "Alice Tan",
				dateLabel: row.timeLabel,
				expanded: true,
				snippet: row.snippet,
				bodyHtml: `<p>${row.snippet}</p>`,
			},
		],
	};
}

/**
 * A suggestion, once a person has said yes to it.
 *
 * `settledZone` is the clock the reader picked, empty when the mail stated one
 * itself. Picking a clock is not a label: the hour the mail printed is read on
 * that zone and written again on this calendar's, so the event lands on the
 * instant the answer meant.
 */
export function eventFromSuggestion(
	suggestion: EventSuggestion,
	id: string,
	settledZone: string,
): CalendarEventData {
	const settled = settledZone !== "";
	const span = settled
		? wallSpanOn(suggestion, settledZone, HOME_ZONE)
		: { start: suggestion.start, end: suggestion.end };
	return {
		id,
		calendarId: suggestion.suggestedCalendarId,
		title: suggestion.title,
		start: span.start,
		end: span.end,
		allDay: suggestion.allDay,
		location: suggestion.location,
		notes: "",
		attendees: [],
		myRsvp: "accepted",
		threadId: suggestion.threadId,
		threadSubject: suggestion.threadSubject,
		timeZone: settled ? settledZone : suggestion.timeZone,
		zoneCertainty: settled ? "explicit" : suggestion.zoneCertainty,
		recurrenceRule: "",
		seriesId: "",
		seriesException: false,
		status: "confirmed",
	};
}
