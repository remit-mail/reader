import type {
	CalendarAttendee,
	CalendarColorId,
	CalendarEventData,
	CalendarInvite,
	CalendarParseMethod,
	CalendarSlotPick,
	EventSuggestion,
	ThreadRowData,
	ThreadSection,
} from "@remit/ui";
import {
	at,
	events as baseEvents,
	suggestions as baseSuggestions,
	calendarsById,
	day,
	event,
	HOME_ZONE,
	pad,
	personalCalendarId,
	travelCalendarId,
	workCalendarId,
} from "./calendar.js";
import { allThreads, personalId, workId } from "./workspace.js";

/**
 * What Option B needs on top of the shared fixture week: the mail that decides
 * a time. An invitation with a clash the reader has not been told about, a
 * thread proposing three slots two of which are already booked, and the
 * confirmations a parser can read at three different levels of certainty.
 *
 * Nothing here mutates the shared week. The extra events are a second list that
 * the screen concatenates, so Option C sees exactly the fixtures it was given.
 */

function guest(
	name: string,
	email: string,
	rsvp: CalendarAttendee["rsvp"],
	role: CalendarAttendee["role"] = "attendee",
): CalendarAttendee {
	return { name, email, rsvp, role };
}

/** The Thursday everything in this file argues about. */
export const PROPOSED_DATE = day(11);

/* ------------------------------------------------------------------ */
/* Extra events — Thursday needs texture for free/busy to mean anything */
/* ------------------------------------------------------------------ */

export const seamEvents: CalendarEventData[] = [
	event({
		id: "evt_seam_planning",
		calendarId: workCalendarId,
		title: "Sprint planning",
		start: at(11, 9, 45),
		end: at(11, 10, 45),
		location: "Room Noord",
		attendees: [
			guest("Dana Okafor", "dana@northwind.example", "accepted", "organizer"),
			guest("Marcus Webb", "marcus@northwind.example", "accepted"),
		],
	}),
	event({
		id: "evt_seam_support",
		calendarId: workCalendarId,
		title: "Support rotation review",
		start: at(11, 11),
		end: at(11, 11, 30),
		location: "Meet",
		attendees: [
			guest("Ravi Mehta", "ravi@northwind.example", "accepted", "organizer"),
		],
	}),
	event({
		id: "evt_seam_design_review",
		calendarId: workCalendarId,
		title: "Design review: outbox retries",
		start: at(11, 13),
		end: at(11, 14),
		location: "Studio",
		attendees: [
			guest("Marcus Webb", "marcus@northwind.example", "accepted", "organizer"),
			guest("Carmen Diaz", "carmen@northwind.example", "accepted"),
		],
	}),
];

/** The shared week plus this option's own additions. */
export const seamWeekEvents: CalendarEventData[] = [
	...baseEvents,
	...seamEvents,
];

/* ------------------------------------------------------------------ */
/* Mail this option adds                                               */
/* ------------------------------------------------------------------ */

export interface BodySegment {
	text: string;
	/** Set when these words are the source of a detected time. */
	mark?: string;
}

export interface SeamMessage {
	id: string;
	fromName: string;
	fromEmail: string;
	toLabel: string;
	dateLabel: string;
	paragraphs: BodySegment[][];
	/** A reply that landed after the event was already on the calendar. */
	afterTheFact?: boolean;
}

export interface SeamThread {
	id: string;
	subject: string;
	messages: SeamMessage[];
}

function text(value: string): BodySegment[] {
	return [{ text: value }];
}

export const inviteThreadId = "thr_invite";
export const proposalThreadId = "thr_thursday";

export const inviteThread: SeamThread = {
	id: inviteThreadId,
	subject: "Invitation: Billing migration kickoff — Thu 11 Jun, 14:00",
	messages: [
		{
			id: "msg_invite_1",
			fromName: "Priya Natarajan",
			fromEmail: "priya@northwind.example",
			toLabel: "Alice Tan, Marcus Webb, Dana Okafor, Ravi Mehta",
			dateLabel: "Today 08:05",
			paragraphs: [
				text(
					"Sending this round now so it is in everyone's week before the roadmap review.",
				),
				text(
					"Short agenda: the cutover window, who owns dunning once self-serve ships, and the rollback nobody has written down yet. An hour should be plenty.",
				),
			],
		},
	],
};

export const proposalThread: SeamThread = {
	id: proposalThreadId,
	subject: "Can we meet Thursday?",
	messages: [
		{
			id: "msg_thursday_1",
			fromName: "Sofia Lindgren",
			fromEmail: "sofia@partnerco.example",
			toLabel: "Alice Tan",
			dateLabel: "Today 09:12",
			paragraphs: [
				text(
					"Hoi Alice — the integration doc is ready for a proper walkthrough rather than another round of comments.",
				),
				[
					{ text: "Can we do " },
					{ text: "Thursday", mark: "day" },
					{ text: "? I could manage " },
					{ text: "11:00", mark: "p1" },
					{ text: ", or " },
					{ text: "13:30", mark: "p2" },
					{ text: ", or " },
					{ text: "anything after 15:00", mark: "p3" },
					{ text: " — whatever is least painful. Half an hour is enough." },
				],
			],
		},
	],
};

export const q3EventThread: SeamThread = {
	id: "thr_q3",
	subject: "Q3 roadmap review — agenda + pre-read",
	messages: [
		{
			id: "msg_q3_1",
			fromName: "Priya Natarajan",
			fromEmail: "priya@northwind.example",
			toLabel: "Alice Tan, Marcus Webb",
			dateLabel: "Mon 14:10",
			paragraphs: [
				text("First pass at the agenda — shout if I have missed a topic."),
			],
		},
		{
			id: "msg_q3_2",
			fromName: "Marcus Webb",
			fromEmail: "marcus@northwind.example",
			toLabel: "Priya Natarajan, Alice Tan",
			dateLabel: "Mon 16:42",
			paragraphs: [
				text(
					"Added the threading backlog item. Can we timebox the billing part to twenty minutes?",
				),
			],
		},
		{
			id: "msg_q3_3",
			fromName: "Priya Natarajan",
			fromEmail: "priya@northwind.example",
			toLabel: "Alice Tan, Marcus Webb",
			dateLabel: "Today 08:52",
			paragraphs: [
				text(
					"Final agenda attached. Two open questions on the billing migration I want your read on before we lock scope: whether the legacy export path survives Q4, and who owns the dunning mail once self-serve ships.",
				),
			],
		},
		{
			id: "msg_q3_4",
			fromName: "Priya Natarajan",
			fromEmail: "priya@northwind.example",
			toLabel: "Alice Tan, Marcus Webb",
			dateLabel: "Today 09:41",
			afterTheFact: true,
			paragraphs: [
				text("Running 15 late — start without me, Marcus can take item one."),
			],
		},
	],
};

export const eventThreads: Record<string, SeamThread> = {
	thr_q3: q3EventThread,
	[inviteThreadId]: inviteThread,
	[proposalThreadId]: proposalThread,
};

const seamRows: ThreadRowData[] = [
	{
		id: inviteThreadId,
		accountId: workId,
		fromName: "Priya Natarajan",
		fromEmail: "priya@northwind.example",
		subject: inviteThread.subject,
		snippet:
			"Sending this round now so it is in everyone's week before the roadmap review. Short agenda: the cutover window…",
		timeLabel: "08:05",
		isRead: false,
		trust: "vip",
		category: "personal",
	},
	{
		id: proposalThreadId,
		accountId: workId,
		fromName: "Sofia Lindgren",
		fromEmail: "sofia@partnerco.example",
		subject: proposalThread.subject,
		snippet:
			"Can we do Thursday? I could manage 11:00, or 13:30, or anything after 15:00 — whatever is least painful.",
		timeLabel: "09:12",
		isRead: false,
		trust: "wellknown",
		category: "personal",
	},
	{
		id: "thr_klm",
		accountId: personalId,
		fromName: "KLM",
		fromEmail: "noreply@klm.example",
		subject: "Your booking is confirmed — KL1693 Amsterdam to Lisbon",
		snippet:
			"Booking reference 8ZQK4M. Departs 19 June 18:40 from Schiphol, arrives 20:25. Check in from 24 hours before.",
		timeLabel: "07:48",
		isRead: false,
		category: "transactional",
	},
];

/** The seam's own mail on top of the shared inbox, newest first. */
export function seamSections(): ThreadSection[] {
	return [
		{
			id: "inbox",
			label: "Inbox",
			threads: [...seamRows, ...allThreads.filter((row) => !row.suspicious)],
		},
	];
}

/* ------------------------------------------------------------------ */
/* The invitation                                                      */
/* ------------------------------------------------------------------ */

export const invite: CalendarInvite = {
	id: "inv_billing",
	threadId: inviteThreadId,
	proposed: event({
		id: "evt_invite_billing",
		calendarId: workCalendarId,
		title: "Billing migration kickoff",
		start: at(11, 14),
		end: at(11, 15),
		location: "Room Zuid / Meet",
		threadId: inviteThreadId,
		threadSubject: inviteThread.subject,
		myRsvp: "noReply",
		status: "tentative",
		attendees: [
			guest(
				"Priya Natarajan",
				"priya@northwind.example",
				"accepted",
				"organizer",
			),
			guest("Marcus Webb", "marcus@northwind.example", "accepted"),
			guest("Dana Okafor", "dana@northwind.example", "noReply"),
			guest("Ravi Mehta", "ravi@northwind.example", "tentative"),
		],
	}),
	organizerName: "Priya Natarajan",
	organizerEmail: "priya@northwind.example",
	method: "ics",
	evidence: "invite.ics · METHOD:REQUEST · DTSTART;TZID=Europe/Amsterdam",
	state: "pending",
	sequence: 0,
};

/* ------------------------------------------------------------------ */
/* Times proposed in prose                                             */
/* ------------------------------------------------------------------ */

export interface TimeProposal {
	/** Matches the `mark` on the words in the body it was read from. */
	id: string;
	phrase: string;
	date: string;
	startTime: string;
	endTime: string;
	/** The mail named a boundary rather than a slot. */
	openEnded: boolean;
}

export const proposals: TimeProposal[] = [
	{
		id: "p1",
		phrase: "11:00",
		date: PROPOSED_DATE,
		startTime: "11:00",
		endTime: "11:30",
		openEnded: false,
	},
	{
		id: "p2",
		phrase: "13:30",
		date: PROPOSED_DATE,
		startTime: "13:30",
		endTime: "14:00",
		openEnded: false,
	},
	{
		id: "p3",
		phrase: "anything after 15:00",
		date: PROPOSED_DATE,
		startTime: "15:00",
		endTime: "18:30",
		openEnded: true,
	},
];

/* ------------------------------------------------------------------ */
/* Clock arithmetic the surfaces share                                 */
/* ------------------------------------------------------------------ */

export function toMinutes(clock: string): number {
	const [hours, minutes] = clock.split(":").map(Number);
	return hours * 60 + minutes;
}

export function fromMinutes(total: number): string {
	return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** The window the availability surfaces draw. Outside it nothing is offered. */
export const DAY_START = "08:00";
export const DAY_END = "20:00";

export interface BusyBlock {
	eventId: string;
	title: string;
	start: string;
	end: string;
	color: CalendarColorId;
	calendarName: string;
	accountLabel: string;
	/**
	 * The event's real hours. `start`/`end` are clipped to the drawn window, so
	 * an evening that runs past it is drawn short and still labelled honestly.
	 */
	label: string;
	/** Drawn but not counted as busy: a declined event is not a commitment. */
	declined: boolean;
	/** Column this block sits in when several overlap, and how many there are. */
	lane: number;
	lanes: number;
}

export interface FreeBlock {
	start: string;
	end: string;
	minutes: number;
}

function clip(value: number): number {
	return Math.min(Math.max(value, toMinutes(DAY_START)), toMinutes(DAY_END));
}

/** Every timed event on a day, laid into non-overlapping columns. */
export function dayBlocks(
	date: string,
	source: CalendarEventData[],
): BusyBlock[] {
	const onDay = source
		.filter((item) => !item.allDay && item.start.slice(0, 10) === date)
		.sort((a, b) => a.start.localeCompare(b.start));

	const laneEnds: number[] = [];
	const placed = onDay.map((item) => {
		const start = clip(toMinutes(item.start.slice(11, 16)));
		const end = clip(toMinutes(item.end.slice(11, 16)));
		let lane = laneEnds.findIndex((endsAt) => endsAt <= start);
		if (lane === -1) lane = laneEnds.length;
		laneEnds[lane] = end;
		const calendar = calendarsById.get(item.calendarId);
		return {
			eventId: item.id,
			title: item.title,
			start: fromMinutes(start),
			end: fromMinutes(end),
			color: calendar?.color ?? "cal-1",
			calendarName: calendar?.name ?? "Calendar",
			accountLabel: calendar?.accountLabel ?? "",
			label: `${item.start.slice(11, 16)} – ${item.end.slice(11, 16)}`,
			declined: item.myRsvp === "declined",
			lane,
			lanes: 1,
		};
	});

	const lanes = laneEnds.length === 0 ? 1 : laneEnds.length;
	return placed.map((block) => ({ ...block, lanes }));
}

/** The gaps nothing is booked in, inside the drawn window. */
export function dayFree(blocks: BusyBlock[]): FreeBlock[] {
	const taken = blocks
		.filter((block) => !block.declined)
		.map((block) => [toMinutes(block.start), toMinutes(block.end)] as const)
		.sort((a, b) => a[0] - b[0]);

	const gaps: FreeBlock[] = [];
	let cursor = toMinutes(DAY_START);
	for (const [start, end] of taken) {
		if (start > cursor)
			gaps.push({
				start: fromMinutes(cursor),
				end: fromMinutes(start),
				minutes: start - cursor,
			});
		cursor = Math.max(cursor, end);
	}
	const close = toMinutes(DAY_END);
	if (cursor < close)
		gaps.push({
			start: fromMinutes(cursor),
			end: fromMinutes(close),
			minutes: close - cursor,
		});
	return gaps;
}

/**
 * Slots worth offering someone, cut off the free gaps at the requested length.
 * Rounded up to the next quarter hour so nothing lands at 11:47.
 */
export function slotOffers(
	free: FreeBlock[],
	minutes: number,
	limit = 6,
	notBefore = "09:30",
): CalendarSlotPick[] {
	const floor = toMinutes(notBefore);
	const slots: CalendarSlotPick[] = [];
	for (const gap of free) {
		let cursor = Math.max(toMinutes(gap.start), floor);
		cursor = Math.ceil(cursor / 15) * 15;
		const end = toMinutes(gap.end);
		while (cursor + minutes <= end && slots.length < limit) {
			slots.push({
				date: PROPOSED_DATE,
				startTime: fromMinutes(cursor),
				endTime: fromMinutes(cursor + minutes),
				allDay: false,
			});
			cursor += minutes;
		}
		if (slots.length >= limit) break;
	}
	return slots;
}

/** Whatever a candidate span runs into, so the clash is named before the answer. */
export function overlapping(
	candidate: { start: string; end: string },
	source: CalendarEventData[],
): CalendarEventData[] {
	const from = new Date(candidate.start).getTime();
	const to = new Date(candidate.end).getTime();
	return source.filter((item) => {
		if (item.allDay || item.myRsvp === "declined") return false;
		if (item.id === "evt_invite_billing") return false;
		return (
			new Date(item.start).getTime() < to && from < new Date(item.end).getTime()
		);
	});
}

/** A slot offered to someone else, held on the calendar until they answer. */
export interface SoftHold {
	id: string;
	date: string;
	startTime: string;
	endTime: string;
	/** Plain-language deadline the hold releases itself at. */
	expiresLabel: string;
}

export const HOLD_EXPIRY_LABEL = "Friday 09:00";

/* ------------------------------------------------------------------ */
/* Suggestions, each with the rung of the ladder that answered         */
/* ------------------------------------------------------------------ */

export interface SeamSuggestion {
	suggestion: EventSuggestion;
	method: CalendarParseMethod;
	/** The exact field or words the reading rests on. */
	evidence: string;
	fields: { label: string; value: string; source: string }[];
}

const baseById = new Map(baseSuggestions.map((item) => [item.id, item]));

function reuse(id: string): EventSuggestion {
	const found = baseById.get(id);
	if (!found) throw new Error(`unknown suggestion ${id}`);
	return found;
}

const flightSuggestion: EventSuggestion = {
	id: "sug_flight",
	title: "KL1693 Amsterdam → Lisbon",
	start: at(19, 18, 40),
	end: at(19, 20, 25),
	allDay: false,
	location: "Schiphol, gate D-pier",
	threadId: "thr_klm",
	threadSubject: "Your booking is confirmed — KL1693 Amsterdam to Lisbon",
	sender: "KLM",
	senderAddress: "noreply@klm.example",
	confidence: 0.88,
	ambiguity:
		"The confirmation prints 18:40 and 20:25 and never says whose clock either is on. Lisbon runs an hour behind Amsterdam, so the arrival is either 20:25 or 21:25 for you.",
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

const parcelSuggestion: EventSuggestion = {
	id: "sug_parcel",
	title: "Parcel from bol.com",
	start: at(10, 10, 15),
	end: at(10, 12, 45),
	allDay: false,
	location: "Home",
	threadId: "thr_bol",
	threadSubject: "Je pakket komt morgen tussen 10:15 en 12:45",
	sender: "bol.com",
	senderAddress: "verzending@bol.example",
	confidence: 0.62,
	ambiguity: '"morgen" was measured from the day the mail was sent, 9 June.',
	suggestedCalendarId: personalCalendarId,
	timeZone: HOME_ZONE,
	zoneCertainty: "local",
};

export const seamSuggestions: SeamSuggestion[] = [
	{
		suggestion: flightSuggestion,
		method: "markup",
		evidence: "schema.org FlightReservation · departureTime, arrivalTime",
		fields: [
			{
				label: "Departs",
				value: "19 June, 18:40",
				source: "departureTime, with a zone",
			},
			{
				label: "Arrives",
				value: "20:25",
				source: "arrivalTime, no zone given",
			},
			{ label: "Calendar", value: "Travel", source: "your rule for KLM" },
		],
	},
	{
		suggestion: reuse("sug_lisbon_stay"),
		method: "markup",
		evidence: "schema.org LodgingReservation · checkinTime, checkoutTime",
		fields: [
			{ label: "Check in", value: "19 June", source: "checkinTime" },
			{ label: "Check out", value: "23 June", source: "checkoutTime" },
			{ label: "Where", value: "Alfama, Lisbon", source: "reservationFor" },
		],
	},
	{
		suggestion: parcelSuggestion,
		method: "pattern",
		evidence: '"komt morgen tussen 10:15 en 12:45"',
		fields: [
			{ label: "When", value: "10 June", source: '"morgen", sent on 9 June' },
			{
				label: "Window",
				value: "10:15 – 12:45",
				source: '"tussen 10:15 en 12:45"',
			},
		],
	},
	{
		suggestion: reuse("sug_toscanini"),
		method: "pattern",
		evidence: '"the Friday after the offsite, half seven"',
		fields: [
			{
				label: "When",
				value: "19 June",
				source: '"the Friday after the offsite"',
			},
			{ label: "Time", value: "19:30", source: '"half seven"' },
			{ label: "Table", value: "six", source: '"table for six"' },
		],
	},
	{
		suggestion: { ...reuse("sug_analytics_pilot"), zoneCertainty: "local" },
		method: "pattern",
		evidence: '"some time Tuesday"',
		fields: [
			{ label: "When", value: "16 June", source: '"Tuesday", nearest ahead' },
			{ label: "Time", value: "none given", source: "nothing in the mail" },
		],
	},
];

/* ------------------------------------------------------------------ */
/* Who you are meeting, and what they have written lately              */
/* ------------------------------------------------------------------ */

export interface ContactMailItem {
	id: string;
	subject: string;
	timeLabel: string;
	snippet: string;
}

export const contactMail: Record<string, ContactMailItem[]> = {
	"priya@northwind.example": [
		{
			id: "cm_priya_1",
			subject: "Q3 roadmap review — agenda + pre-read",
			timeLabel: "08:52",
			snippet: "Two open questions on the billing migration before we lock…",
		},
		{
			id: "cm_priya_2",
			subject: "Lunch walk Wednesday?",
			timeLabel: "Mon",
			snippet: "Usual canal loop at 12:30? I want to pick your brain anyway.",
		},
		{
			id: "cm_priya_3",
			subject: "Q2 roadmap review — agenda",
			timeLabel: "Mar",
			snippet: "Same shape as last quarter, one fewer topic.",
		},
	],
	"marcus@northwind.example": [
		{
			id: "cm_marcus_1",
			subject: "Re: Reading pane density — a vote for calmer",
			timeLabel: "07:30",
			snippet: "Strong +1 on tightening the rows, keep the pane airy.",
		},
		{
			id: "cm_marcus_2",
			subject: "Billing migration: cutover checklist",
			timeLabel: "May",
			snippet: "Everything that has to be true before we flip the flag.",
		},
	],
	"dana@northwind.example": [
		{
			id: "cm_dana_1",
			subject: "Offsite logistics — rooms, travel, the dinner",
			timeLabel: "Mon",
			snippet: "Rooms held through Friday — confirm yours by EOD Wednesday.",
		},
		{
			id: "cm_dana_2",
			subject: "Sprint retro notes assigned to you: 2 follow-ups",
			timeLabel: "Fri",
			snippet: "Outbox retry policy, and the DKIM edge case as an RFC.",
		},
	],
	"ravi@northwind.example": [
		{
			id: "cm_ravi_1",
			subject: "[FIRING:1] imap-worker error rate > 2%",
			timeLabel: "Mon",
			snippet: "Fired at 11:02 UTC. Runbook in doc/runbooks/imap-worker.md",
		},
	],
	"sofia@partnerco.example": [
		{
			id: "cm_sofia_1",
			subject: "Can we meet Thursday?",
			timeLabel: "09:12",
			snippet: "The integration doc is ready for a proper walkthrough.",
		},
		{
			id: "cm_sofia_2",
			subject: "PartnerCo review — deck and open items",
			timeLabel: "2 Jun",
			snippet: "Nine slides, three of them are the open items.",
		},
	],
};
