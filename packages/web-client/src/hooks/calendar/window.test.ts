/**
 * The window a view asks the server about.
 *
 * What matters is that the window is a property of the screenful rather than of
 * the day the address happens to name: every day inside one week has to produce
 * the same `from` and `to`, because that is what makes stepping back to a week
 * already read a cache hit instead of a second request for the same days.
 *
 * The offsets are the device's, so the assertions are about the civil dates and
 * about windows agreeing with each other — never about a literal `+02:00`,
 * which would only pass on a runner in Amsterdam.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDays, calendarWindow, calendarWindowOfDays, isoAt } from "./window";

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
