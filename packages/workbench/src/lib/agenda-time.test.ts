/**
 * The strip's arithmetic. Free time and collapsed runs are claims the design
 * makes on screen — "you have a free afternoon", "five days with nothing
 * booked" — so they are measured off the fixtures rather than asserted by hand.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDay } from "../fixtures/calendar.js";
import { agendaEvents } from "../fixtures/calendar-agenda.js";
import {
	buildAgendaRows,
	datesBetween,
	formatSpan,
	freeStretchesOn,
	groupOverlapping,
	readNextUp,
} from "./agenda-time.js";

const days = datesBetween("2026-06-01", "2026-07-05").map((date) =>
	buildDay(date, agendaEvents),
);

describe("free time", () => {
	it("measures the gap the busiest day still leaves open", () => {
		const stretches = freeStretchesOn(buildDay("2026-06-10", agendaEvents));
		assert.deepEqual(
			stretches.map((stretch) => stretch.minutes),
			[285, 195],
		);
	});

	it("counts overlapping events as the clock time they cover, once", () => {
		const day = buildDay("2026-06-10", agendaEvents);
		assert.equal(day.timed.length, 8);
		assert.equal(day.busyMinutes, 210);
	});

	it("treats a day with nothing timed on it as free all day", () => {
		const [whole] = freeStretchesOn(buildDay("2026-06-13", agendaEvents));
		assert.equal(whole.wholeDay, true);
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
		assert.equal(nextUp.restOfDay, 7);
	});

	it("reaches past the meetings to the afternoon they leave open", () => {
		assert.equal(nextUp.free?.minutes, 285);
	});
});

describe("groupOverlapping", () => {
	it("keeps the pile-up together and leaves the rest alone", () => {
		const day = buildDay("2026-06-10", agendaEvents);
		assert.deepEqual(
			groupOverlapping(day.timed).map((group) => group.length),
			[1, 5, 1, 1],
		);
	});
});

describe("formatSpan", () => {
	it("says hours and minutes the way a person would", () => {
		assert.equal(formatSpan(45), "45m");
		assert.equal(formatSpan(120), "2h");
		assert.equal(formatSpan(285), "4h 45m");
	});
});
