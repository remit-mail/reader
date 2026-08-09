import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type CustomRecurrence,
	dayOfMonthLabel,
	defaultCustomRecurrence,
	defaultEndDate,
	formatCustomRecurrence,
	ordinalWeekdayLabel,
	readCustomRecurrence,
	repeatChoices,
} from "./recurrence.js";

/** Thursday 11 June 2026. */
const DATE = "2026-06-11";

const rule = (patch: Partial<CustomRecurrence> = {}): CustomRecurrence => ({
	...defaultCustomRecurrence(DATE),
	...patch,
});

describe("repeatChoices", () => {
	it("derives the monthly choice from the date's own weekday", () => {
		assert.ok(
			repeatChoices(DATE, "").includes("Every month on the second Thursday"),
		);
	});

	it("appends the hour when there is one", () => {
		assert.ok(repeatChoices(DATE, "09:15").includes("Every day, 09:15"));
	});

	it("offers weekdays only when the date is one", () => {
		assert.ok(!repeatChoices("2026-06-13", "").includes("Every weekday"));
	});
});

describe("defaultCustomRecurrence", () => {
	it("starts on the event's own weekday", () => {
		assert.deepEqual(defaultCustomRecurrence(DATE).weekdays, [4]);
	});

	it("survives a date it cannot read", () => {
		assert.deepEqual(defaultCustomRecurrence("").weekdays, []);
	});
});

describe("formatCustomRecurrence", () => {
	it("reads a rule in words, never as an RRULE", () => {
		const text = formatCustomRecurrence(
			rule({
				interval: 2,
				weekdays: [1, 4],
				ends: { kind: "onDate", date: "2026-10-03" },
			}),
			DATE,
			"",
		);
		assert.equal(text, "Every 2 weeks on Monday and Thursday, until 3 October");
	});

	it("drops the interval when it is one", () => {
		assert.equal(
			formatCustomRecurrence(rule({ weekdays: [4] }), DATE, ""),
			"Every week on Thursday",
		);
	});

	it("counts an ending that is counted", () => {
		assert.equal(
			formatCustomRecurrence(
				rule({ unit: "day", ends: { kind: "afterCount", count: 13 } }),
				DATE,
				"",
			),
			"Every day, 13 times",
		);
	});

	it("says which of the two monthly readings is meant", () => {
		assert.equal(
			formatCustomRecurrence(rule({ unit: "month" }), DATE, ""),
			"Every month on day 11",
		);
		assert.equal(
			formatCustomRecurrence(
				rule({ unit: "month", monthlyMode: "weekdayOfMonth" }),
				DATE,
				"",
			),
			"Every month on the second Thursday",
		);
	});

	it("carries the hour", () => {
		assert.equal(
			formatCustomRecurrence(rule({ unit: "year" }), DATE, "09:15"),
			"Every year on 11 June, 09:15",
		);
	});
});

describe("readCustomRecurrence", () => {
	for (const seed of [
		rule({ interval: 2, weekdays: [1, 4] }),
		rule({ interval: 3, unit: "day" }),
		rule({ unit: "month", monthlyMode: "weekdayOfMonth" }),
		rule({ unit: "year" }),
		rule({ weekdays: [0, 2, 6], ends: { kind: "afterCount", count: 13 } }),
		rule({ ends: { kind: "onDate", date: "2026-10-03" } }),
	])
		it(`reopens on "${formatCustomRecurrence(seed, DATE, "")}"`, () => {
			const text = formatCustomRecurrence(seed, DATE, "09:15");
			const read = readCustomRecurrence(text, DATE);
			assert.ok(read);
			assert.equal(formatCustomRecurrence(read, DATE, "09:15"), text);
		});

	it("declines a sentence it did not write", () => {
		assert.equal(readCustomRecurrence("Every weekday, 09:15", DATE), undefined);
		assert.equal(
			readCustomRecurrence("whenever Jane is free", DATE),
			undefined,
		);
		assert.equal(
			readCustomRecurrence("Every week on Blursday", DATE),
			undefined,
		);
	});
});

describe("labels", () => {
	it("offers an end date a year out", () => {
		assert.equal(defaultEndDate(DATE), "2027-06-11");
	});

	it("names the two readings of the same day", () => {
		assert.equal(dayOfMonthLabel(DATE), "day 11");
		assert.equal(ordinalWeekdayLabel(DATE), "the second Thursday");
	});
});
