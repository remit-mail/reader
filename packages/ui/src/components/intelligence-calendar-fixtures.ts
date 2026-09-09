import type {
	CalendarAttendee,
	CalendarClash,
	CalendarEventData,
	CalendarInvite,
	CalendarProposal,
	CalendarSlotPick,
	EventSuggestion,
} from "./calendar-types.js";
import type {
	CalendarDayEntry,
	CalendarInviteIntel,
	CalendarProseIntel,
	CalendarSuggestionIntel,
	IntelligenceCalendarData,
} from "./intelligence-calendar.js";
import type { IntelligenceData } from "./intelligence-panel.js";

/**
 * The Thursday everything in this file argues about, and the mail that argues
 * about it. Entirely synthetic: invented people at `.example` domains, no
 * address that resolves and no booking that exists. The shapes match the
 * workbench's calendar-mail fixtures so the two prototypes describe one
 * product rather than two.
 */

const OFFSET = "+02:00";
const HOME_ZONE = "Europe/Amsterdam";

const workCalendarId = "cal_work";
const personalCalendarId = "cal_personal";
const travelCalendarId = "cal_travel";

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function at(dayOfMonth: number, hour: number, minute = 0): string {
	return `2026-06-${pad(dayOfMonth)}T${pad(hour)}:${pad(minute)}:00${OFFSET}`;
}

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

function guest(
	name: string,
	email: string,
	rsvp: CalendarAttendee["rsvp"],
	role: CalendarAttendee["role"] = "attendee",
): CalendarAttendee {
	return { name, email, rsvp, role };
}

export const THURSDAY_LABEL = "Thursday 11 June";

const inviteThreadId = "thr_invite";
const flightThreadId = "thr_klm";

/* ------------------------------------------------------------------ */
/* What is already true about the day                                  */
/* ------------------------------------------------------------------ */

const sprintPlanning = event({
	id: "evt_planning",
	calendarId: workCalendarId,
	title: "Sprint planning",
	start: at(11, 9, 45),
	end: at(11, 10, 45),
	location: "Room Noord",
	recurrenceRule: "Every Thursday, 09:45",
	seriesId: "ser_planning",
});

const supportRotation = event({
	id: "evt_support",
	calendarId: workCalendarId,
	title: "Support rotation review",
	start: at(11, 11),
	end: at(11, 11, 30),
	location: "Meet",
});

const designReview = event({
	id: "evt_design_review",
	calendarId: workCalendarId,
	title: "Design review: outbox retries",
	start: at(11, 13),
	end: at(11, 14),
	location: "Studio",
	threadId: "thr_outbox",
	threadSubject: "Outbox retries — the shape of the backoff",
});

const dentist = event({
	id: "evt_dentist",
	calendarId: personalCalendarId,
	title: "Dentist",
	start: at(11, 14, 30),
	end: at(11, 15, 15),
	location: "Overtoom 210",
});

export const thursdayEntries: CalendarDayEntry[] = [
	{ event: sprintPlanning, timeText: "09:45", color: "cal-2" },
	{ event: supportRotation, timeText: "11:00", color: "cal-2" },
	{ event: designReview, timeText: "13:00", color: "cal-2" },
	{ event: dentist, timeText: "14:30", color: "cal-4" },
];

/* ------------------------------------------------------------------ */
/* The invitation                                                      */
/* ------------------------------------------------------------------ */

const proposedAttendees: CalendarAttendee[] = [
	guest("Priya Natarajan", "priya@northwind.example", "accepted", "organizer"),
	guest("Marcus Webb", "marcus@northwind.example", "accepted"),
	guest("Dana Okafor", "dana@northwind.example", "noReply"),
	guest("Ravi Mehta", "ravi@northwind.example", "tentative"),
];

const proposedKickoff = event({
	id: "evt_invite_billing",
	calendarId: workCalendarId,
	title: "Billing migration kickoff",
	start: at(11, 14),
	end: at(11, 15),
	location: "Room Zuid / Meet",
	threadId: inviteThreadId,
	threadSubject: "Invitation: Billing migration kickoff — Thu 11 Jun, 14:00",
	myRsvp: "noReply",
	status: "tentative",
	attendees: proposedAttendees,
});

export const kickoffInvite: CalendarInvite = {
	id: "inv_billing",
	threadId: inviteThreadId,
	proposed: proposedKickoff,
	organizerName: "Priya Natarajan",
	organizerEmail: "priya@northwind.example",
	method: "ics",
	evidence: "invite.ics · METHOD:REQUEST · DTSTART;TZID=Europe/Amsterdam",
	state: "pending",
	sequence: 0,
};

/** The clash the reader would otherwise find out about after saying yes. */
export const dentistClash: CalendarClash[] = [
	{ id: dentist.id, label: "Dentist · 14:30 – 15:15 · Personal (matthijs@)" },
];

const kickoffIntel: CalendarInviteIntel = {
	invite: kickoffInvite,
	whenText: "Thursday 11 June, 14:00 – 15:00",
	calendarName: "Work",
	color: "cal-2",
	clashes: dentistClash,
	rsvp: "noReply",
};

/** The same invitation an hour later, where the afternoon is still empty. */
const clearIntel: CalendarInviteIntel = {
	...kickoffIntel,
	invite: {
		...kickoffInvite,
		proposed: {
			...proposedKickoff,
			start: at(11, 16),
			end: at(11, 17),
		},
	},
	whenText: "Thursday 11 June, 16:00 – 17:00",
	clashes: [],
};

/** A later message carried a higher SEQUENCE for the same UID. */
const supersededIntel: CalendarInviteIntel = {
	...kickoffIntel,
	invite: {
		...kickoffInvite,
		state: "superseded",
		sequence: 1,
		evidence: "invite.ics · METHOD:REQUEST · SEQUENCE:1",
	},
};

/** METHOD:CANCEL on something already accepted. It stays until the reader acts. */
const cancelledIntel: CalendarInviteIntel = {
	...kickoffIntel,
	invite: {
		...kickoffInvite,
		state: "cancelled",
		sequence: 2,
		method: "ics",
		evidence: "cancel.ics · METHOD:CANCEL · STATUS:CANCELLED",
		proposed: { ...proposedKickoff, myRsvp: "accepted", status: "confirmed" },
	},
	rsvp: "accepted",
	clashes: [],
};

/* ------------------------------------------------------------------ */
/* Times named in prose                                                */
/* ------------------------------------------------------------------ */

const thursdayProposals: CalendarProposal[] = [
	{ id: "p1", phrase: "11:00", clashTitle: supportRotation.title },
	{ id: "p2", phrase: "13:30", clashTitle: designReview.title },
	{ id: "p3", phrase: "after 15:00", clashTitle: "" },
];

const THURSDAY = "2026-06-11";

function slot(startTime: string, endTime: string): CalendarSlotPick {
	return { date: THURSDAY, startTime, endTime, allDay: false };
}

const thursdaySlots: CalendarSlotPick[] = [
	slot("10:45", "11:15"),
	slot("11:30", "12:00"),
	slot("12:00", "12:30"),
	slot("15:15", "15:45"),
	slot("16:00", "16:30"),
];

export const thursdayProse: CalendarProseIntel = {
	dayLabel: THURSDAY_LABEL,
	proposals: thursdayProposals,
	slots: thursdaySlots,
	picked: [],
};

/* ------------------------------------------------------------------ */
/* Readings that are not invitations                                   */
/* ------------------------------------------------------------------ */

const flightSuggestion: EventSuggestion = {
	id: "sug_flight",
	title: "KL1693 Amsterdam → Lisbon",
	start: at(19, 18, 40),
	end: at(19, 20, 25),
	allDay: false,
	location: "Schiphol, gate D-pier",
	threadId: flightThreadId,
	threadSubject: "Your booking is confirmed — KL1693 Amsterdam to Lisbon",
	sender: "KLM",
	senderAddress: "noreply@klm.example",
	confidence: 0.88,
	ambiguity:
		"The confirmation prints 20:25 for the arrival and never says whose clock. Lisbon runs an hour behind Amsterdam.",
	suggestedCalendarId: travelCalendarId,
	timeZone: "",
	zoneCertainty: "ambiguous",
	zoneOptions: [
		{
			timeZone: "Europe/Lisbon",
			label: "20:25 in Lisbon",
			note: "21:25 on your own clock. What an airline usually means.",
		},
		{
			timeZone: HOME_ZONE,
			label: "20:25 in Amsterdam",
			note: "19:25 where the plane lands.",
		},
	],
};

const flightIntel: CalendarSuggestionIntel = {
	suggestion: flightSuggestion,
	whenText: "Friday 19 June, 18:40 – 20:25",
};

/* ------------------------------------------------------------------ */
/* The tab, in each state the review is about                          */
/* ------------------------------------------------------------------ */

export const inviteWithClash: IntelligenceCalendarData = {
	invite: kickoffIntel,
	suggestions: [],
	day: thursdayEntries,
	dayLabel: THURSDAY_LABEL,
};

export const inviteWithoutClash: IntelligenceCalendarData = {
	invite: clearIntel,
	suggestions: [],
	day: thursdayEntries,
	dayLabel: THURSDAY_LABEL,
};

export const supersededInvite: IntelligenceCalendarData = {
	invite: supersededIntel,
	suggestions: [],
	day: thursdayEntries,
	dayLabel: THURSDAY_LABEL,
};

export const cancelledInvite: IntelligenceCalendarData = {
	invite: cancelledIntel,
	suggestions: [],
	day: thursdayEntries,
	dayLabel: THURSDAY_LABEL,
};

export const flightConfirmation: IntelligenceCalendarData = {
	suggestions: [flightIntel],
	day: [],
	dayLabel: "Friday 19 June",
};

export const proseTimeThread: IntelligenceCalendarData = {
	prose: thursdayProse,
	suggestions: [],
	day: thursdayEntries,
	dayLabel: THURSDAY_LABEL,
};

export const nothingAboutTime: IntelligenceCalendarData = {
	suggestions: [],
	day: [],
	dayLabel: "",
};

/* ------------------------------------------------------------------ */
/* The other half of the panel, so the strip has two sides             */
/* ------------------------------------------------------------------ */

export const organiserSender: IntelligenceData = {
	sender: {
		name: "Priya Natarajan",
		email: "priya@northwind.example",
		trust: "vip",
		firstSeenLabel: "Mar 2023",
		inboundCount: 214,
		replyCount: 188,
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "northwind.example",
		dkimDomain: "northwind.example",
		summary: "This message was signed by northwind.example.",
	},
	category: { value: "personal" },
	flags: { vip: true },
	similar: [],
};

export const airlineSender: IntelligenceData = {
	sender: {
		name: "KLM",
		email: "noreply@klm.example",
		trust: "wellknown",
		firstSeenLabel: "Jan 2024",
		inboundCount: 31,
		replyCount: 0,
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "klm.example",
		dkimDomain: "klm.example",
		summary: "This message was signed by klm.example.",
	},
	category: { value: "transactional" },
	similar: [],
};
