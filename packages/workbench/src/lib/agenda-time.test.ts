/**
 * The strip's arithmetic. Free time and collapsed runs are claims the design
 * makes on screen — "you have a free afternoon", "five days with nothing
 * booked" — so every number here is worked out from the fixture week by hand
 * and written down. Moving an event in the fixtures is meant to fail this file.
 *
 * The suite runs in the zone the fixtures are written in, so the labels the
 * helpers format never depend on where the machine is.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalendarEventData } from "@remit/ui";
import {
	buildDay,
	eventFromSuggestion,
	HOME_ZONE,
	suggestions,
} from "../fixtures/calendar.js";
import { agendaEvents } from "../fixtures/calendar-agenda.js";
import {
	dayBlocks,
	dayFree,
	invite,
	overlapping,
	PROPOSED_DATE,
	proposals,
	seamWeekEvents,
	slotOffers,
} from "../fixtures/calendar-mail.js";
import {
	buildAgendaRows,
	clashesWith,
	datesBetween,
	formatMinute,
	formatSpan,
	freeStretchesOn,
	groupOverlapping,
	readNextUp,
	slotsIn,
	wallTimeOn,
} from "./agenda-time.js";

const days = datesBetween("2026-06-01", "2026-07-05").map((date) =>
	buildDay(date, agendaEvents),
);

const proposedDay = buildDay(PROPOSED_DATE, seamWeekEvents);

/** The hour a mail printed with no clock behind it, on a placeholder offset. */
const PRINTED_HOUR = "2026-06-17T16:00:00+02:00";

function suggestionNamed(id: string) {
	const found = suggestions.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`unknown suggestion ${id}`);
	return found;
}

const zoneless = suggestionNamed("sug_lisbon_call");

/** The day once the invitation has been answered, as the screen assembles it. */
const answeredEvents = [
	...seamWeekEvents,
	{
		...invite.proposed,
		myRsvp: "accepted" as const,
		status: "confirmed" as const,
	},
];

/** A time proposed inside the invitation's own hour, clear of the dentist. */
const ownHour = spanAt(PROPOSED_DATE, "14:00", "14:15", "+02:00");

function spanAt(date: string, from: string, to: string, offset: string) {
	return {
		start: `${date}T${from}:00${offset}`,
		end: `${date}T${to}:00${offset}`,
	};
}

/**
 * The zones the machine might be in. The hour is what noon UTC reads as there,
 * asserted so a Node that ignored the switch could not pass the body silently.
 */
const ZONES = [
	{ name: "UTC", hourAtNoonUtc: 12 },
	{ name: "Pacific/Kiritimati", hourAtNoonUtc: 2 },
	{ name: "America/Los_Angeles", hourAtNoonUtc: 5 },
];

function inEveryZone(body: () => void): void {
	const before = process.env.TZ;
	try {
		for (const zone of ZONES) {
			process.env.TZ = zone.name;
			assert.equal(
				new Date("2026-06-11T12:00:00Z").getHours(),
				zone.hourAtNoonUtc,
				`the machine never moved to ${zone.name}`,
			);
			body();
		}
	} finally {
		if (before === undefined) delete process.env.TZ;
		else process.env.TZ = before;
	}
}

/** One evening dropped on a clear day, written the way the editor writes it. */
function lateEvent(date: string, from: string, to: string): CalendarEventData {
	return {
		...invite.proposed,
		id: `evt_late_${from}_${to}`,
		...spanAt(date, from, to, "+02:00"),
		myRsvp: "accepted" as const,
		status: "confirmed" as const,
	};
}

function clocks(slots: { startMinute: number; endMinute: number }[]): string[] {
	return slots.map(
		(slot) =>
			`${formatMinute(slot.startMinute)}–${formatMinute(slot.endMinute)}`,
	);
}

describe("free time", () => {
	it("measures the gap the busiest day still leaves open", () => {
		const stretches = freeStretchesOn(buildDay("2026-06-10", agendaEvents));
		assert.deepEqual(
			stretches.map((stretch) => stretch.minutes),
			[165, 195],
		);
	});

	it("counts overlapping events as the clock time they cover, once", () => {
		const day = buildDay("2026-06-10", agendaEvents);
		assert.equal(day.timed.length, 9);
		assert.equal(day.busyMinutes, 270);
	});

	it("treats a day with nothing timed on it as free all day", () => {
		const [whole] = freeStretchesOn(buildDay("2026-06-13", agendaEvents));
		assert.equal(whole.wholeDay, true);
	});

	/**
	 * The editor writes one date, so 23:00–01:00 comes back as a span that ends
	 * before it starts. It is still one evening taken off the day, never two
	 * bands over the same morning — the strip keys them by their start minute.
	 */
	it("gives one band for an event whose end is before its start", () => {
		const day = buildDay("2026-06-13", [
			...agendaEvents,
			lateEvent("2026-06-13", "23:00", "01:00"),
		]);
		assert.deepEqual(clocks(freeStretchesOn(day)), ["08:00–22:00"]);
	});

	it("clips a stretch to the window the day is measured inside", () => {
		const day = buildDay("2026-06-13", [
			...agendaEvents,
			lateEvent("2026-06-13", "22:30", "23:00"),
		]);
		assert.deepEqual(clocks(freeStretchesOn(day)), ["08:00–22:00"]);
	});
});

describe("buildAgendaRows", () => {
	const rows = buildAgendaRows(days, ["2026-06-10"]);

	it("collapses a run of empty days into one row", () => {
		const run = rows.find(
			(row) => row.kind === "run" && row.from === "2026-06-20",
		);
		assert.ok(run && run.kind === "run");
		assert.equal(run.to, "2026-06-24");
		assert.equal(run.days, 5);
	});

	it("keeps a day carrying only an all-day banner as its own row", () => {
		assert.ok(
			rows.some((row) => row.kind === "day" && row.day.date === "2026-06-13"),
		);
	});

	it("never collapses a day it was told to keep", () => {
		assert.ok(
			rows.some((row) => row.kind === "day" && row.day.date === "2026-06-10"),
		);
	});
});

describe("readNextUp", () => {
	const nextUp = readNextUp(days, "2026-06-10T09:30:00+02:00");

	it("names the next thing and how long until it", () => {
		assert.equal(nextUp.next?.id, "evt_q3_roadmap");
		assert.equal(nextUp.minutesUntilNext, 30);
		assert.equal(nextUp.after?.id, "evt_incident_review");
	});

	it("counts what is left of today", () => {
		assert.equal(nextUp.restOfDay, 8);
	});

	it("reaches past the morning pile-up to the gap after lunch", () => {
		assert.equal(nextUp.free?.startMinute, 13 * 60 + 15);
		assert.equal(nextUp.free?.endMinute, 16 * 60);
		assert.equal(nextUp.free?.minutes, 165);
	});
});

describe("groupOverlapping", () => {
	it("keeps the pile-up together and leaves the rest alone", () => {
		const day = buildDay("2026-06-10", agendaEvents);
		assert.deepEqual(
			groupOverlapping(day.timed).map((group) => group.length),
			[1, 5, 1, 1, 1],
		);
	});
});

describe("clashesWith", () => {
	it("names what the invitation runs into, across accounts", () => {
		const clash = clashesWith(invite.proposed, seamWeekEvents);
		assert.deepEqual(
			clash.map((event) => event.id),
			["evt_dentist"],
		);
	});

	it("answers the invitation and every proposal as the seam screen did", () => {
		const spans = [
			invite.proposed,
			ownHour,
			...proposals.map((proposal) =>
				spanAt(proposal.date, proposal.startTime, proposal.endTime, "+02:00"),
			),
		];
		for (const span of spans) {
			assert.deepEqual(
				clashesWith(span, answeredEvents, {
					ignoreIds: [invite.proposed.id],
				}),
				overlapping(span, answeredEvents),
			);
		}
	});

	it("keeps an answered invitation out of the verdict on its own hour", () => {
		assert.deepEqual(
			clashesWith(ownHour, answeredEvents).map((event) => event.id),
			[invite.proposed.id],
		);
		assert.deepEqual(
			clashesWith(ownHour, answeredEvents, {
				ignoreIds: [invite.proposed.id],
			}),
			[],
		);
	});

	it("leaves the candidate out of its own clash list", () => {
		const source = [...seamWeekEvents, invite.proposed];
		assert.ok(
			clashesWith(invite.proposed, source).some(
				(event) => event.id === invite.proposed.id,
			),
		);
		assert.deepEqual(
			clashesWith(invite.proposed, source, {
				ignoreIds: [invite.proposed.id],
			}).map((event) => event.id),
			["evt_dentist"],
		);
	});

	it("gives every proposed time the verdict the thread pane prints", () => {
		const verdicts = proposals.map((proposal) =>
			clashesWith(
				spanAt(proposal.date, proposal.startTime, proposal.endTime, "+02:00"),
				seamWeekEvents,
			).map((event) => event.id),
		);
		assert.deepEqual(verdicts, [
			["evt_seam_support"],
			["evt_seam_design_review"],
			[],
		]);
	});

	it("lets one span end where the next begins", () => {
		const clash = clashesWith(
			spanAt(PROPOSED_DATE, "15:00", "15:30", "+02:00"),
			seamWeekEvents,
		);
		assert.deepEqual(clash, []);
	});

	it("skips an all-day banner and a declined invitation", () => {
		const evening = spanAt(PROPOSED_DATE, "18:45", "19:15", "+02:00");
		const clash = clashesWith(evening, seamWeekEvents);
		assert.ok(!clash.some((event) => event.id === "evt_aws_meetup"));
		assert.deepEqual(
			clash.map((event) => event.id),
			["evt_offsite_dinner"],
		);
		const banner = { ...invite.proposed, id: "evt_banner", allDay: true };
		assert.deepEqual(clashesWith(invite.proposed, [banner]), []);
	});

	it("answers the same in every machine zone, off the offsets it is given", () => {
		const abroad = {
			...invite.proposed,
			id: "evt_abroad",
			start: "2026-06-11T17:30:00+05:30",
			end: "2026-06-11T18:30:00+05:30",
		};
		const home = spanAt("2026-06-11", "14:30", "15:30", "+02:00");
		const later = spanAt("2026-06-11", "15:00", "16:00", "+02:00");

		inEveryZone(() => {
			assert.deepEqual(
				clashesWith(home, [abroad]).map((event) => event.id),
				["evt_abroad"],
			);
			assert.deepEqual(clashesWith(later, [abroad]), []);
		});
	});
});

describe("slotsIn", () => {
	it("cuts the same slots out of the same day in every machine zone", () => {
		inEveryZone(() => {
			const day = buildDay(PROPOSED_DATE, seamWeekEvents);
			assert.deepEqual(clocks(slotsIn(freeStretchesOn(day), 30, 3)), [
				"11:30–12:00",
				"12:00–12:30",
				"12:30–13:00",
			]);
		});
	});

	it("offers the day the same half hours the availability column did", () => {
		const bFree = dayFree(dayBlocks(PROPOSED_DATE, seamWeekEvents));
		for (const limit of [6, 8]) {
			assert.deepEqual(
				clocks(slotsIn(freeStretchesOn(proposedDay), 30, limit)),
				slotOffers(bFree, 30, limit).map((slot) => `${slot.start}–${slot.end}`),
			);
		}
	});

	it("stamps every slot with the day it was cut from", () => {
		const [first] = slotsIn(freeStretchesOn(proposedDay), 30, 1);
		assert.equal(first.date, PROPOSED_DATE);
	});

	it("rounds up to the next quarter hour", () => {
		const ragged = [
			{
				date: PROPOSED_DATE,
				startMinute: 11 * 60 + 47,
				endMinute: 13 * 60,
				minutes: 73,
				wholeDay: false,
			},
		];
		assert.deepEqual(clocks(slotsIn(ragged, 30, 6)), [
			"12:00–12:30",
			"12:30–13:00",
		]);
	});

	it("offers nothing before the day has started", () => {
		const dawn = [
			{
				date: PROPOSED_DATE,
				startMinute: 8 * 60,
				endMinute: 10 * 60,
				minutes: 120,
				wholeDay: false,
			},
		];
		assert.deepEqual(clocks(slotsIn(dawn, 30, 6)), ["09:30–10:00"]);
		assert.deepEqual(clocks(slotsIn(dawn, 30, 6, 8 * 60)), [
			"08:00–08:30",
			"08:30–09:00",
			"09:00–09:30",
			"09:30–10:00",
		]);
	});

	it("stops at the limit and skips a stretch too short to cut", () => {
		const stretches = [
			{
				date: PROPOSED_DATE,
				startMinute: 10 * 60,
				endMinute: 10 * 60 + 20,
				minutes: 20,
				wholeDay: false,
			},
			{
				date: PROPOSED_DATE,
				startMinute: 15 * 60,
				endMinute: 18 * 60,
				minutes: 180,
				wholeDay: false,
			},
		];
		assert.deepEqual(clocks(slotsIn(stretches, 30, 2)), [
			"15:00–15:30",
			"15:30–16:00",
		]);
	});

	it("holds a declined evening as busy, where the old column offered it", () => {
		const stretches = freeStretchesOn(proposedDay);
		const last = stretches[stretches.length - 1];
		assert.equal(formatMinute(last.endMinute), "18:30");
		const bLast = dayFree(dayBlocks(PROPOSED_DATE, seamWeekEvents)).at(-1);
		assert.equal(bLast?.end, "19:00");
	});
});

describe("formatSpan", () => {
	it("says hours and minutes the way a person would", () => {
		assert.equal(formatSpan(45), "45m");
		assert.equal(formatSpan(120), "2h");
		assert.equal(formatSpan(285), "4h 45m");
	});
});

describe("a clock the mail never named", () => {
	it("reads the printed hour on the zone that was picked, wherever the machine is", () => {
		inEveryZone(() => {
			assert.equal(
				wallTimeOn(PRINTED_HOUR, "Europe/Lisbon", HOME_ZONE),
				"2026-06-17T17:00:00+02:00",
			);
			assert.equal(
				wallTimeOn(PRINTED_HOUR, HOME_ZONE, HOME_ZONE),
				"2026-06-17T16:00:00+02:00",
			);
			assert.equal(
				wallTimeOn(PRINTED_HOUR, "America/Los_Angeles", HOME_ZONE),
				"2026-06-18T01:00:00+02:00",
			);
		});
	});

	it("books the instant the answer meant, not a relabelled one", () => {
		const booked = eventFromSuggestion(zoneless, "evt_booked", "Europe/Lisbon");
		assert.equal(booked.start, "2026-06-17T17:00:00+02:00");
		assert.equal(booked.end, "2026-06-17T18:00:00+02:00");
		assert.equal(booked.timeZone, "Europe/Lisbon");
		assert.equal(booked.zoneCertainty, "explicit");
	});

	it("leaves the printed hour standing when the answer is the reader's own clock", () => {
		const booked = eventFromSuggestion(zoneless, "evt_booked", HOME_ZONE);
		assert.equal(booked.start, zoneless.start);
		assert.equal(booked.timeZone, HOME_ZONE);
	});

	it("touches nothing on a suggestion whose mail stated the clock", () => {
		const stay = suggestionNamed("sug_lisbon_stay");
		const booked = eventFromSuggestion(stay, "evt_stay", "");
		assert.equal(booked.start, stay.start);
		assert.equal(booked.end, stay.end);
		assert.equal(booked.timeZone, stay.timeZone);
		assert.equal(booked.zoneCertainty, stay.zoneCertainty);
	});
});
