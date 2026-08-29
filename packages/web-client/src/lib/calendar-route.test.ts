/**
 * The calendar's address, rule by rule — which tier holds which fact, what a
 * segment the calendar cannot read resolves to, and what a query string it did
 * not write is allowed to say.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CALENDAR_DENSITY_KEY } from "./calendar-density.js";
import {
	calendarSearchSchema,
	calendarViewMountsGrid,
	calendarViews,
	canonicalCalendarParams,
	DEFAULT_CALENDAR_VIEW,
	isoDate,
	parseCalendarDate,
	parseCalendarView,
	readCalendarIds,
	stepCalendarDate,
} from "./calendar-route.js";

const TODAY = "2026-06-10";

describe("parseCalendarView", () => {
	it("reads every zoom the ladder has", () => {
		for (const view of calendarViews) {
			assert.equal(parseCalendarView(view), view);
		}
	});

	it("reads a segment that names no zoom as none", () => {
		assert.equal(parseCalendarView("fortnight"), undefined);
		assert.equal(parseCalendarView("Week"), undefined);
		assert.equal(parseCalendarView(""), undefined);
	});
});

describe("parseCalendarDate", () => {
	it("reads a day the calendar has", () => {
		assert.equal(parseCalendarDate("2026-06-10"), "2026-06-10");
		assert.equal(parseCalendarDate("2024-02-29"), "2024-02-29");
	});

	it("refuses a day the calendar does not have", () => {
		assert.equal(parseCalendarDate("2026-02-30"), undefined);
		assert.equal(parseCalendarDate("2026-13-01"), undefined);
		assert.equal(parseCalendarDate("2025-02-29"), undefined);
	});

	it("refuses anything that is not the one spelling", () => {
		assert.equal(parseCalendarDate("2026-6-10"), undefined);
		assert.equal(parseCalendarDate("10-06-2026"), undefined);
		assert.equal(parseCalendarDate("2026-06-10T09:30"), undefined);
		assert.equal(parseCalendarDate("today"), undefined);
		assert.equal(parseCalendarDate(""), undefined);
	});
});

describe("canonicalCalendarParams", () => {
	it("leaves an address it can read alone", () => {
		assert.deepEqual(
			canonicalCalendarParams({ view: "day", date: "2026-06-10" }, TODAY),
			{ view: "day", date: "2026-06-10" },
		);
	});

	it("keeps the half it could read", () => {
		assert.deepEqual(
			canonicalCalendarParams({ view: "fortnight", date: "2026-06-10" }, TODAY),
			{ view: DEFAULT_CALENDAR_VIEW, date: "2026-06-10" },
		);
		assert.deepEqual(
			canonicalCalendarParams({ view: "day", date: "yesterday" }, TODAY),
			{ view: "day", date: TODAY },
		);
	});

	it("sends an address it can read nothing of to this week", () => {
		assert.deepEqual(canonicalCalendarParams({ view: "", date: "" }, TODAY), {
			view: DEFAULT_CALENDAR_VIEW,
			date: TODAY,
		});
	});
});

describe("calendarViewMountsGrid", () => {
	it("draws the week and the day", () => {
		assert.equal(calendarViewMountsGrid("week"), true);
		assert.equal(calendarViewMountsGrid("day"), true);
	});

	it("has the other three still to come", () => {
		assert.equal(calendarViewMountsGrid("year"), false);
		assert.equal(calendarViewMountsGrid("month"), false);
		assert.equal(calendarViewMountsGrid("agenda"), false);
	});
});

describe("stepCalendarDate", () => {
	it("steps a screenful in the view's own unit", () => {
		assert.equal(stepCalendarDate("2026-06-10", "day", 1), "2026-06-11");
		assert.equal(stepCalendarDate("2026-06-10", "week", 1), "2026-06-17");
		assert.equal(stepCalendarDate("2026-06-10", "agenda", 1), "2026-06-17");
		assert.equal(stepCalendarDate("2026-06-10", "month", 1), "2026-07-10");
		assert.equal(stepCalendarDate("2026-06-10", "year", 1), "2027-06-10");
	});

	it("steps back the same distance it steps forward", () => {
		for (const view of calendarViews) {
			const forward = stepCalendarDate("2026-06-10", view, 1);
			assert.equal(stepCalendarDate(forward, view, -1), "2026-06-10");
		}
	});

	it("crosses a month, a year and a leap day", () => {
		assert.equal(stepCalendarDate("2026-12-31", "day", 1), "2027-01-01");
		assert.equal(stepCalendarDate("2026-01-01", "day", -1), "2025-12-31");
		assert.equal(stepCalendarDate("2024-02-28", "day", 1), "2024-02-29");
		assert.equal(stepCalendarDate("2026-12-15", "month", 1), "2027-01-15");
		assert.equal(stepCalendarDate("2026-01-15", "month", -1), "2025-12-15");
	});

	it("holds a month step to a day that month has", () => {
		assert.equal(stepCalendarDate("2026-03-31", "month", -1), "2026-02-28");
		assert.equal(stepCalendarDate("2026-01-31", "month", 1), "2026-02-28");
		assert.equal(stepCalendarDate("2024-01-31", "month", 1), "2024-02-29");
		assert.equal(stepCalendarDate("2024-02-29", "year", 1), "2025-02-28");
	});
});

describe("isoDate", () => {
	it("names the day an instant falls on by the device's own clock", () => {
		assert.equal(isoDate(new Date(2026, 5, 10, 9, 30)), "2026-06-10");
		assert.equal(isoDate(new Date(2026, 0, 1, 0, 0)), "2026-01-01");
		assert.equal(isoDate(new Date(2026, 11, 31, 23, 59)), "2026-12-31");
	});
});

describe("readCalendarIds", () => {
	it("reads repeated params, a single one, and none", () => {
		assert.deepEqual(readCalendarIds(["cal_a", "cal_b"]), ["cal_a", "cal_b"]);
		assert.deepEqual(readCalendarIds("cal_a"), ["cal_a"]);
		assert.deepEqual(readCalendarIds(undefined), []);
	});

	it("spells one set of ticked calendars one way", () => {
		assert.deepEqual(readCalendarIds(["cal_b", "cal_a", "cal_b"]), [
			"cal_a",
			"cal_b",
		]);
	});

	it("keeps a numeric-looking id the router handed through as a number", () => {
		assert.deepEqual(readCalendarIds([12, "cal_a"]), ["12", "cal_a"]);
	});

	it("drops what is not an id rather than refusing the address", () => {
		assert.deepEqual(readCalendarIds(["", "cal_a", null, { id: "x" }]), [
			"cal_a",
		]);
	});
});

describe("calendarSearchSchema", () => {
	it("carries the ticked calendars", () => {
		assert.deepEqual(calendarSearchSchema.parse({ calendarId: "cal_a" }), {
			calendarId: ["cal_a"],
		});
		assert.deepEqual(
			calendarSearchSchema.parse({ calendarId: ["cal_b", "cal_a"] }),
			{ calendarId: ["cal_a", "cal_b"] },
		);
	});

	it("leaves the param out where nothing is ticked off", () => {
		// Absent rather than empty: the router writes no param for `undefined`, so
		// a calendar showing everything is one the query says nothing about.
		assert.equal(calendarSearchSchema.parse({}).calendarId, undefined);
		assert.equal(
			calendarSearchSchema.parse({ calendarId: [] }).calendarId,
			undefined,
		);
		assert.equal(
			calendarSearchSchema.parse({ calendarId: ["", null] }).calendarId,
			undefined,
		);
	});

	it("strips a param that is not the calendar's to carry", () => {
		const parsed = calendarSearchSchema.parse({
			calendarId: ["cal_a"],
			q: "invoice",
			// Density is a device preference, so an address naming one is ignored
			// rather than obeyed: a link must not resize another reader's day.
			density: "compact",
			date: "2026-06-10",
		});
		assert.deepEqual(parsed, { calendarId: ["cal_a"] });
	});
});

describe("density is not URL state", () => {
	it("is stored against the device, under a key of its own", () => {
		assert.equal(CALENDAR_DENSITY_KEY, "remit:calendar-density");
	});

	it("has no reading in the query", () => {
		assert.deepEqual(calendarSearchSchema.parse({ density: "compact" }), {});
	});
});
