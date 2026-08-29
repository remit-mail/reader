/**
 * The strip's arithmetic, on days written here rather than read from anywhere.
 *
 * Free time and collapsed runs are claims the design makes on screen — "your
 * afternoon is clear", "five days with nothing booked" — so every number is
 * worked out by hand and written down. The suite runs in whatever zone the
 * machine is in, so anything that would answer differently in Los Angeles than
 * in Amsterdam is asserted in more than one.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	CalendarDay,
	CalendarEventData,
} from "../components/calendar-types.js";
import {
	addDays,
	buildAgendaRows,
	buildCalendarDay,
	busyMinutesOf,
	busySpansOn,
	clashesWith,
	conflictsOf,
	datesBetween,
	formatMinute,
	formatRunLabel,
	formatShortDay,
	formatSpan,
	freeAhead,
	freeStretchesFromSpans,
	freeStretchesOn,
	groupOverlapping,
	isClearDay,
	isEmptyDay,
	minuteOfDay,
	monthLabel,
	readNextUp,
	shortMonthLabel,
	wallSpanOn,
	weekdayLongLabel,
	weekdayShortLabel,
} from "./agenda-time.js";

const HOME_ZONE = "Europe/Amsterdam";
const TODAY = "2026-06-10";

/** Every offset the fixtures print, so instants never depend on the machine. */
const OFFSET = "+02:00";

function event(
	id: string,
	date: string,
	from: string,
	to: string,
	extra: Partial<CalendarEventData> = {},
): CalendarEventData {
	return {
		id,
		calendarId: "c1",
		title: id,
		start: `${date}T${from}:00${OFFSET}`,
		end: `${date}T${to}:00${OFFSET}`,
		allDay: false,
		location: "",
		notes: "",
		attendees: [],
		myRsvp: "accepted",
		threadId: "",
		threadSubject: "",
		timeZone: HOME_ZONE,
		zoneCertainty: "explicit",
		recurrenceRule: "",
		seriesId: "",
		seriesException: false,
		status: "confirmed",
		...extra,
	};
}

function banner(id: string, from: string, to: string): CalendarEventData {
	return {
		...event(id, from, "00", "00"),
		start: from,
		end: to,
		allDay: true,
	};
}

/**
 * Wednesday the 10th: a morning pile-up, lunch, an afternoon gap, one late
 * meeting. Thursday carries a banner and nothing on the clock. Friday through
 * Tuesday are empty. The 17th has one event again.
 */
const events: CalendarEventData[] = [
	event("evt_standup", TODAY, "09:00", "09:15"),
	event("evt_roadmap", TODAY, "10:00", "11:30"),
	event("evt_incident", TODAY, "10:30", "12:00"),
	event("evt_1to1", TODAY, "11:00", "11:20"),
	event("evt_lunch", TODAY, "12:00", "13:15", { location: "Toscanini" }),
	event("evt_retro", TODAY, "16:00", "17:00", {
		recurrenceRule: "Every Wednesday",
		threadId: "thr_retro",
	}),
	banner("evt_conference", "2026-06-11", "2026-06-12"),
	event("evt_offsite", "2026-06-17", "14:00", "15:00"),
];

function dayOn(date: string, source = events): CalendarDay {
	return buildCalendarDay(date, source, TODAY);
}

const days = datesBetween(TODAY, "2026-06-18").map((date) => dayOn(date));

function clocks(
	stretches: { startMinute: number; endMinute: number }[],
): string[] {
	return stretches.map(
		(stretch) =>
			`${formatMinute(stretch.startMinute)}–${formatMinute(stretch.endMinute)}`,
	);
}

/** The zones the machine might be in, asserted so a body cannot pass silently. */
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

describe("buildCalendarDay", () => {
	it("sorts the clock and keeps the banners apart from it", () => {
		const day = dayOn(TODAY);
		assert.deepEqual(
			day.timed.map((item) => item.id),
			[
				"evt_standup",
				"evt_roadmap",
				"evt_incident",
				"evt_1to1",
				"evt_lunch",
				"evt_retro",
			],
		);
		assert.deepEqual(day.allDay, []);
		assert.equal(day.dayNumber, 10);
		assert.equal(day.isToday, true);
	});

	it("carries an all-day range on every day it covers but the last", () => {
		assert.deepEqual(
			dayOn("2026-06-11").allDay.map((item) => item.id),
			["evt_conference"],
		);
		assert.deepEqual(dayOn("2026-06-12").allDay, []);
	});

	it("counts overlapping events as the clock time they cover, once", () => {
		const day = dayOn(TODAY);
		assert.equal(day.timed.length, 6);
		assert.equal(day.busyMinutes, 15 + 195 + 60);
	});

	it("names the pile-up and leaves a clean day empty", () => {
		assert.deepEqual(dayOn(TODAY).conflicts, [
			["evt_1to1", "evt_incident", "evt_roadmap"],
		]);
		assert.deepEqual(dayOn("2026-06-17").conflicts, []);
	});

	it("counts nothing as no minutes and no clashes", () => {
		assert.equal(busyMinutesOf([]), 0);
		assert.deepEqual(conflictsOf([]), []);
	});
});

describe("free time", () => {
	it("measures the gaps the busiest day still leaves open", () => {
		assert.deepEqual(clocks(freeStretchesOn(dayOn(TODAY))), [
			"13:15–16:00",
			"17:00–22:00",
		]);
	});

	it("ignores a gap too short to be free time", () => {
		const packed = dayOn("2026-06-18", [
			event("evt_a", "2026-06-18", "08:00", "12:00"),
			event("evt_b", "2026-06-18", "13:00", "22:00"),
		]);
		assert.deepEqual(freeStretchesOn(packed), []);
	});

	it("treats a day with nothing timed on it as free all day", () => {
		const [whole] = freeStretchesOn(dayOn("2026-06-11"));
		assert.equal(whole.wholeDay, true);
		assert.deepEqual(clocks([whole]), ["08:00–22:00"]);
	});

	/**
	 * The editor writes one date, so 23:00–01:00 comes back as a span that ends
	 * before it starts. It is still one evening taken off the day, never two
	 * bands over the same morning.
	 */
	it("gives one band for an event whose end is before its start", () => {
		const day = dayOn("2026-06-13", [
			event("evt_late", "2026-06-13", "23:00", "01:00"),
		]);
		assert.deepEqual(clocks(freeStretchesOn(day)), ["08:00–22:00"]);
	});

	it("clips a stretch to the window the day is measured inside", () => {
		const day = dayOn("2026-06-13", [
			event("evt_late", "2026-06-13", "22:30", "23:00"),
		]);
		assert.deepEqual(clocks(freeStretchesOn(day)), ["08:00–22:00"]);
	});

	it("merges a pile-up into the hours it actually covers", () => {
		assert.deepEqual(busySpansOn(dayOn(TODAY)), [
			{ from: 9 * 60, to: 9 * 60 + 15 },
			{ from: 10 * 60, to: 13 * 60 + 15 },
			{ from: 16 * 60, to: 17 * 60 },
		]);
	});

	it("says whether a day is clear of the clock, banners aside", () => {
		assert.equal(isClearDay(dayOn("2026-06-11")), true);
		assert.equal(isEmptyDay(dayOn("2026-06-11")), false);
		assert.equal(isEmptyDay(dayOn("2026-06-14")), true);
		assert.equal(isClearDay(dayOn(TODAY)), false);
	});
});

/**
 * The same rule, measured off spans nobody drew. `/calendar-free-busy` merges
 * every calendar the reader holds, so the answer to "am I free" has to come out
 * of that rather than out of the rows on screen — and it has to be the answer
 * the rows would have given, or the strip and the server disagree about one
 * afternoon.
 */
describe("freeStretchesFromSpans", () => {
	const spans = (day: CalendarDay) =>
		freeStretchesFromSpans(day.date, busySpansOn(day));

	it("gives the same answer as the day it was measured off", () => {
		for (const date of [TODAY, "2026-06-11", "2026-06-13"]) {
			const day = dayOn(date);
			assert.deepEqual(clocks(spans(day)), clocks(freeStretchesOn(day)));
		}
	});

	it("takes hours out of a day nothing on the strip is booked in", () => {
		const busy = [
			{ from: 9 * 60, to: 12 * 60 },
			{ from: 13 * 60, to: 16 * 60 },
		];
		assert.deepEqual(clocks(freeStretchesFromSpans("2026-06-11", busy)), [
			"16:00–22:00",
		]);
	});

	it("reads no spans at all as free all day", () => {
		const [whole] = freeStretchesFromSpans("2026-06-11", []);
		assert.equal(whole.wholeDay, true);
		assert.deepEqual(clocks([whole]), ["08:00–22:00"]);
	});

	it("clips a span that runs past the window the day is measured inside", () => {
		assert.deepEqual(
			clocks(freeStretchesFromSpans("2026-06-11", [{ from: 0, to: 9 * 60 }])),
			["09:00–22:00"],
		);
	});
});

describe("buildAgendaRows", () => {
	const rows = buildAgendaRows(days, [TODAY]);

	it("collapses a run of empty days into one row", () => {
		const run = rows.find((row) => row.kind === "run");
		assert.ok(run && run.kind === "run");
		assert.equal(run.from, "2026-06-12");
		assert.equal(run.to, "2026-06-16");
		assert.equal(run.days, 5);
	});

	it("keeps a day carrying only an all-day banner as its own row", () => {
		assert.ok(
			rows.some((row) => row.kind === "day" && row.day.date === "2026-06-11"),
		);
	});

	it("never collapses a day it was told to keep", () => {
		const kept = buildAgendaRows(days, ["2026-06-14"]);
		assert.ok(
			kept.some((row) => row.kind === "day" && row.day.date === "2026-06-14"),
		);
	});

	it("collapses a run that reaches the end of the strip", () => {
		const trailing = buildAgendaRows(
			datesBetween("2026-06-12", "2026-06-16").map((date) => dayOn(date)),
			[],
		);
		assert.deepEqual(
			trailing.map((row) => row.kind),
			["run"],
		);
	});

	it("leaves a single empty day as a day rather than a run of one", () => {
		const single = buildAgendaRows(
			[dayOn("2026-06-16"), dayOn("2026-06-17")],
			[],
		);
		assert.deepEqual(
			single.map((row) => row.kind),
			["day", "day"],
		);
	});
});

describe("groupOverlapping", () => {
	it("keeps the pile-up together and leaves the rest alone", () => {
		assert.deepEqual(
			groupOverlapping(dayOn(TODAY).timed).map((group) => group.length),
			[1, 3, 1, 1],
		);
	});
});

describe("readNextUp", () => {
	const nextUp = readNextUp(days, `${TODAY}T09:05:00${OFFSET}`);

	it("names what is running, what is next and how long until it", () => {
		assert.deepEqual(
			nextUp.running.map((item) => item.id),
			["evt_standup"],
		);
		assert.equal(nextUp.next?.id, "evt_roadmap");
		assert.equal(nextUp.minutesUntilNext, 55);
		assert.equal(nextUp.after?.id, "evt_incident");
	});

	it("counts what is left of today, including what is running", () => {
		assert.equal(nextUp.restOfDay, 6);
	});

	it("reaches past the pile-up to the gap after lunch", () => {
		assert.equal(nextUp.free?.startMinute, 13 * 60 + 15);
		assert.equal(nextUp.free?.endMinute, 16 * 60);
	});

	it("says nothing is next once the day is done", () => {
		const done = readNextUp(days, "2026-06-18T21:00:00+02:00");
		assert.equal(done.next, undefined);
		assert.equal(done.minutesUntilNext, 0);
		assert.equal(done.restOfDay, 0);
	});
});

describe("freeAhead", () => {
	it("clips today's first stretch to start no earlier than now", () => {
		const [first] = freeAhead(days, `${TODAY}T14:00:00${OFFSET}`, 1);
		assert.deepEqual(clocks([first]), ["14:00–16:00"]);
		assert.equal(first.wholeDay, false);
	});

	it("skips a stretch that now has already eaten", () => {
		const [first] = freeAhead(days, `${TODAY}T15:00:00${OFFSET}`, 1);
		assert.deepEqual(clocks([first]), ["17:00–22:00"]);
	});

	it("looks past today and stops at the limit it was given", () => {
		const found = freeAhead(days, "2026-06-11T09:00:00+02:00", 2);
		assert.deepEqual(
			found.map((stretch) => stretch.date),
			["2026-06-11", "2026-06-12"],
		);
	});

	it("returns everything it found when the strip runs out first", () => {
		assert.deepEqual(freeAhead([], `${TODAY}T09:00:00${OFFSET}`, 3), []);
	});
});

describe("clashesWith", () => {
	const source = dayOn(TODAY).timed;

	it("names what a candidate runs into", () => {
		assert.deepEqual(
			clashesWith(
				{
					start: `${TODAY}T11:00:00${OFFSET}`,
					end: `${TODAY}T11:30:00${OFFSET}`,
				},
				source,
			).map((item) => item.id),
			["evt_roadmap", "evt_incident", "evt_1to1"],
		);
	});

	it("lets one span end where the next begins", () => {
		assert.deepEqual(
			clashesWith(
				{
					start: `${TODAY}T09:15:00${OFFSET}`,
					end: `${TODAY}T09:45:00${OFFSET}`,
				},
				source,
			),
			[],
		);
	});

	it("skips an all-day banner and a declined invitation", () => {
		const declined = event("evt_declined", TODAY, "14:00", "15:00", {
			myRsvp: "declined",
		});
		const candidate = {
			start: `${TODAY}T14:15:00${OFFSET}`,
			end: `${TODAY}T14:45:00${OFFSET}`,
		};
		assert.deepEqual(clashesWith(candidate, [declined]), []);
		assert.deepEqual(
			clashesWith(candidate, [banner("evt_banner", TODAY, "2026-06-12")]),
			[],
		);
	});

	it("keeps a span it was told to ignore out of its own verdict", () => {
		const candidate = source[1];
		assert.ok(
			clashesWith(candidate, source).some((item) => item.id === candidate.id),
		);
		assert.deepEqual(
			clashesWith(candidate, source, { ignoreIds: [candidate.id] }).map(
				(item) => item.id,
			),
			["evt_incident", "evt_1to1"],
		);
	});

	it("answers the same in every machine zone, off the offsets it is given", () => {
		const abroad = {
			...event("evt_abroad", TODAY, "00", "00"),
			start: `${TODAY}T17:30:00+05:30`,
			end: `${TODAY}T18:30:00+05:30`,
		};
		const home = {
			start: `${TODAY}T14:30:00${OFFSET}`,
			end: `${TODAY}T15:30:00${OFFSET}`,
		};
		const later = {
			start: `${TODAY}T15:00:00${OFFSET}`,
			end: `${TODAY}T16:00:00${OFFSET}`,
		};

		inEveryZone(() => {
			assert.deepEqual(
				clashesWith(home, [abroad]).map((item) => item.id),
				["evt_abroad"],
			);
			assert.deepEqual(clashesWith(later, [abroad]), []);
		});
	});
});

describe("a clock the mail never named", () => {
	const printed = {
		start: "2026-06-17T16:00:00+02:00",
		end: "2026-06-17T17:00:00+02:00",
	};

	it("reads the printed hour on the zone that was picked, wherever the machine is", () => {
		inEveryZone(() => {
			assert.deepEqual(wallSpanOn(printed, "Europe/Lisbon", HOME_ZONE), {
				start: "2026-06-17T17:00:00+02:00",
				end: "2026-06-17T18:00:00+02:00",
			});
			assert.deepEqual(wallSpanOn(printed, HOME_ZONE, HOME_ZONE), printed);
		});
	});

	it("keeps whole-hour arithmetic away from the zones that are not on it", () => {
		assert.equal(
			wallSpanOn(printed, "Asia/Kathmandu", HOME_ZONE).start,
			"2026-06-17T12:15:00+02:00",
		);
	});

	it("carries the printed length over a spring-forward instead of losing an hour", () => {
		const booked = wallSpanOn(
			{ start: "2026-03-29T01:30:00+00:00", end: "2026-03-29T03:30:00+00:00" },
			"Europe/Lisbon",
			HOME_ZONE,
		);
		assert.deepEqual(booked, {
			start: "2026-03-29T03:30:00+02:00",
			end: "2026-03-29T05:30:00+02:00",
		});
	});

	it("leaves an all-day value alone, having no clock to read", () => {
		assert.deepEqual(
			wallSpanOn(
				{ start: "2026-06-19", end: "2026-06-23" },
				"Europe/Lisbon",
				HOME_ZONE,
			),
			{ start: "2026-06-19", end: "2026-06-23" },
		);
	});
});

describe("labels and arithmetic", () => {
	it("says hours and minutes the way a person would", () => {
		assert.equal(formatSpan(45), "45m");
		assert.equal(formatSpan(120), "2h");
		assert.equal(formatSpan(285), "4h 45m");
	});

	it("clamps a clock to the day it belongs to", () => {
		assert.equal(formatMinute(-30), "00:00");
		assert.equal(formatMinute(9 * 60 + 5), "09:05");
		assert.equal(formatMinute(30 * 60), "24:00");
	});

	it("reads the minute out of an ISO string without a zone conversion", () => {
		inEveryZone(() => {
			assert.equal(minuteOfDay(`${TODAY}T09:15:00${OFFSET}`), 9 * 60 + 15);
		});
	});

	it("walks dates across a month boundary", () => {
		assert.equal(addDays("2026-06-30", 1), "2026-07-01");
		assert.equal(addDays("2026-06-01", -1), "2026-05-31");
		assert.deepEqual(datesBetween("2026-06-30", "2026-07-02"), [
			"2026-06-30",
			"2026-07-01",
			"2026-07-02",
		]);
	});

	it("collapses the month when both ends of a run share one", () => {
		assert.equal(
			formatRunLabel("2026-06-12", "2026-06-16"),
			"Fri 12 – Tue 16 Jun",
		);
		assert.equal(
			formatRunLabel("2026-06-29", "2026-07-02"),
			"Mon 29 Jun – Thu 2 Jul",
		);
	});

	it("names a day the same in every machine zone", () => {
		inEveryZone(() => {
			assert.equal(monthLabel(TODAY), "June 2026");
			assert.equal(shortMonthLabel(TODAY), "Jun");
			assert.equal(formatShortDay(TODAY), "Wed 10 Jun");
			assert.equal(weekdayLongLabel(TODAY), "Wednesday");
			assert.equal(weekdayShortLabel(TODAY), "Wed");
		});
	});
});
