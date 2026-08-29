/**
 * The window a view asks the server about.
 *
 * What matters is that the window is a property of the screenful rather than of
 * the day the address happens to name: every day inside one week has to produce
 * the same `from` and `to`, because that is what makes stepping back to a week
 * already read a cache hit instead of a second request for the same days.
 *
 * A window carries the device's own offsets, so those assertions are about
 * civil dates and about windows agreeing with each other rather than about a
 * literal `+02:00` that would only hold on a runner in Amsterdam. The zoned
 * times below are the opposite: absolute, because the whole point of them is
 * that the runner's zone stays out.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	addDays,
	calendarWindow,
	calendarWindowOfDays,
	isoAt,
	isoAtInZone,
} from "./window";

const day = (iso: string): string => iso.slice(0, 10);

const OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/;

describe("the window a view covers", () => {
	it("takes the whole week a day falls in, starting Monday", () => {
		const window = calendarWindow("week", "2026-06-10");
		assert.equal(day(window.from), "2026-06-08");
		assert.equal(day(window.to), "2026-06-15");
	});

	it("gives every day of one week the same window", () => {
		const monday = calendarWindow("week", "2026-06-08");
		for (const date of ["2026-06-09", "2026-06-11", "2026-06-14"]) {
			assert.deepEqual(calendarWindow("week", date), monday);
		}
	});

	it("takes one day at the day zoom", () => {
		const window = calendarWindow("day", "2026-06-10");
		assert.equal(day(window.from), "2026-06-10");
		assert.equal(day(window.to), "2026-06-11");
	});

	it("takes the calendar month, ending on the first of the next", () => {
		const window = calendarWindow("month", "2026-06-10");
		assert.equal(day(window.from), "2026-06-01");
		assert.equal(day(window.to), "2026-07-01");
	});

	it("rolls a December month into the next year", () => {
		assert.equal(day(calendarWindow("month", "2026-12-31").to), "2027-01-01");
	});

	it("takes the calendar year", () => {
		const window = calendarWindow("year", "2026-06-10");
		assert.equal(day(window.from), "2026-01-01");
		assert.equal(day(window.to), "2027-01-01");
	});

	it("gives the agenda the week it steps by, so it shares the grid's entry", () => {
		assert.deepEqual(
			calendarWindow("agenda", "2026-06-10"),
			calendarWindow("week", "2026-06-10"),
		);
	});

	it("carries an explicit offset at both ends, as the API asks for", () => {
		const window = calendarWindow("week", "2026-06-10");
		assert.match(window.from, OFFSET);
		assert.match(window.to, OFFSET);
	});
});

describe("a window a surface rolls itself", () => {
	it("runs whole days from the date it was given", () => {
		const window = calendarWindowOfDays("2026-06-10", 3);
		assert.equal(day(window.from), "2026-06-10");
		assert.equal(day(window.to), "2026-06-13");
	});
});

describe("civil dates", () => {
	it("steps across a month boundary", () => {
		assert.equal(addDays("2026-06-30", 1), "2026-07-01");
		assert.equal(addDays("2026-03-01", -1), "2026-02-28");
	});

	it("puts a clock time on a day with the offset that day is on", () => {
		assert.match(isoAt("2026-06-10", "09:15"), OFFSET);
		assert.ok(isoAt("2026-06-10", "09:15").startsWith("2026-06-10T09:15:00"));
	});
});

/**
 * A named zone's offset, read without touching the runner's own clock. Every
 * expectation here is absolute, because a test that reads the device offset
 * cannot see the bug where the device offset leaked in.
 */
describe("a clock time in a named zone", () => {
	it("carries that zone's summer offset", () => {
		assert.equal(
			isoAtInZone("2026-06-10", "09:15", "Europe/Amsterdam"),
			"2026-06-10T09:15:00+02:00",
		);
		assert.equal(
			isoAtInZone("2026-06-10", "09:15", "America/New_York"),
			"2026-06-10T09:15:00-04:00",
		);
	});

	it("carries its winter offset for a winter date", () => {
		assert.equal(
			isoAtInZone("2026-01-14", "09:15", "Europe/Amsterdam"),
			"2026-01-14T09:15:00+01:00",
		);
	});

	it("settles a time on the far side of a spring-forward", () => {
		// The Netherlands moves to +02:00 at 02:00 on 29 March 2026.
		assert.equal(
			isoAtInZone("2026-03-29", "09:00", "Europe/Amsterdam"),
			"2026-03-29T09:00:00+02:00",
		);
		assert.equal(
			isoAtInZone("2026-03-29", "00:30", "Europe/Amsterdam"),
			"2026-03-29T00:30:00+01:00",
		);
	});

	it("handles a zone that is not a whole number of hours off", () => {
		assert.equal(
			isoAtInZone("2026-06-10", "09:15", "Asia/Kolkata"),
			"2026-06-10T09:15:00+05:30",
		);
	});

	it("falls back to the device rather than throwing on a zone nothing knows", () => {
		assert.match(
			isoAtInZone("2026-06-10", "09:15", "Mars/Olympus_Mons"),
			OFFSET,
		);
	});
});
