/**
 * The rolling range, and the busy time it is measured against.
 *
 * The strip never paginates, so the claims here are about continuity: reaching
 * an end grows the run rather than replacing it, a day already held keeps the
 * days either side of it, and a jump opens a window where it landed. The
 * free-time half asserts that busy spans the strip did not draw still take the
 * hours they cover — the rule itself is `@remit/ui`'s, and this only decides
 * which spans a day gets.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { freeStretchesFromSpans } from "@remit/ui";
import {
	agendaWindow,
	busySpansByDate,
	datesInRange,
	extendRangeEnd,
	extendRangeStart,
	freeStretchesByDate,
	LEAD_IN,
	LEAD_OUT,
	PAGE,
	rangeAround,
	rangeCovering,
} from "./agenda-window.js";
import { startOfDay } from "./window.js";

const DATE = "2026-06-10";

/** The offset this machine is on, so a fixture reads the same in any zone. */
const offsetOn = (date: string): string => startOfDay(date).slice(19);

const at = (date: string, time: string): string =>
	`${date}T${time}:00${offsetOn(date)}`;

const clocks = (
	stretches: readonly { startMinute: number; endMinute: number }[],
): string[] =>
	stretches.map(
		(stretch) =>
			`${Math.floor(stretch.startMinute / 60)}–${Math.floor(stretch.endMinute / 60)}`,
	);

describe("the days the strip holds", () => {
	it("opens further ahead than behind, because a diary is read forwards", () => {
		const range = rangeAround(DATE);
		assert.equal(range.from, "2026-05-31");
		assert.equal(range.to, "2026-07-04");
		assert.equal(datesInRange(range).length, LEAD_IN + LEAD_OUT + 1);
	});

	it("grows the run at whichever end was reached, keeping the other", () => {
		const range = rangeAround(DATE);
		assert.deepEqual(extendRangeStart(range), {
			from: "2026-05-17",
			to: range.to,
		});
		assert.deepEqual(extendRangeEnd(range), {
			from: range.from,
			to: "2026-07-18",
		});
		assert.equal(
			datesInRange(extendRangeEnd(range)).length,
			datesInRange(range).length + PAGE,
		);
	});

	it("keeps the run a day is already in, so a scroll refetches nothing", () => {
		const range = rangeAround(DATE);
		for (const day of ["2026-05-31", DATE, "2026-06-28", "2026-07-04"]) {
			assert.equal(rangeCovering(range, day), range, `${day} moved the run`);
		}
	});

	it("opens a window where a jump landed rather than stretching to it", () => {
		const range = rangeAround(DATE);
		assert.deepEqual(
			rangeCovering(range, "2026-11-02"),
			rangeAround("2026-11-02"),
		);
		assert.deepEqual(
			rangeCovering(range, "2026-01-05"),
			rangeAround("2026-01-05"),
		);
	});
});

describe("the window the API is asked for", () => {
	it("runs to the morning after the last day, so its evening is in it", () => {
		const window = agendaWindow({ from: "2026-06-01", to: "2026-06-03" });
		assert.equal(window.from, startOfDay("2026-06-01"));
		assert.equal(window.to, startOfDay("2026-06-04"));
	});

	it("carries an explicit offset, which is what the endpoint takes", () => {
		assert.match(
			agendaWindow({ from: "2026-06-01", to: "2026-06-03" }).from,
			/^2026-06-01T00:00:00[+-]\d{2}:\d{2}$/,
		);
	});
});

describe("busy time, split into the days it covers", () => {
	const dates = ["2026-06-10", "2026-06-11", "2026-06-12"];

	it("reads a span as minutes of the day it falls on", () => {
		const byDate = busySpansByDate(dates, [
			{ start: at("2026-06-10", "09:00"), end: at("2026-06-10", "10:30") },
		]);
		assert.deepEqual(byDate.get("2026-06-10"), [{ from: 540, to: 630 }]);
		assert.equal(byDate.get("2026-06-11"), undefined);
	});

	it("gives a span crossing midnight one entry per day it touches", () => {
		const byDate = busySpansByDate(dates, [
			{ start: at("2026-06-10", "22:00"), end: at("2026-06-11", "02:00") },
		]);
		assert.deepEqual(byDate.get("2026-06-10"), [{ from: 1320, to: 1440 }]);
		assert.deepEqual(byDate.get("2026-06-11"), [{ from: 0, to: 120 }]);
	});

	it("leaves no entry on the day a span merely ends at midnight of", () => {
		const byDate = busySpansByDate(dates, [
			{ start: at("2026-06-10", "22:00"), end: at("2026-06-11", "00:00") },
		]);
		assert.deepEqual(byDate.get("2026-06-10"), [{ from: 1320, to: 1440 }]);
		assert.equal(byDate.get("2026-06-11"), undefined);
	});

	it("merges spans that run into each other into the hours they cover", () => {
		const byDate = busySpansByDate(dates, [
			{ start: at("2026-06-10", "11:00"), end: at("2026-06-10", "12:00") },
			{ start: at("2026-06-10", "09:00"), end: at("2026-06-10", "11:30") },
		]);
		assert.deepEqual(byDate.get("2026-06-10"), [{ from: 540, to: 720 }]);
	});

	it("drops a span that is not a stretch of time at all", () => {
		const byDate = busySpansByDate(dates, [
			{ start: at("2026-06-10", "11:00"), end: at("2026-06-10", "11:00") },
			{ start: "not a date", end: at("2026-06-10", "12:00") },
		]);
		assert.equal(byDate.size, 0);
	});

	it("ignores busy time outside the days on screen", () => {
		const byDate = busySpansByDate(dates, [
			{ start: at("2026-07-01", "09:00"), end: at("2026-07-01", "10:00") },
		]);
		assert.equal(byDate.size, 0);
	});
});

describe("free time, off the spans the server merged", () => {
	const dates = ["2026-06-10", "2026-06-11"];

	it("answers every day the strip holds, including the untouched ones", () => {
		const free = freeStretchesByDate(dates, []);
		assert.deepEqual([...free.keys()], dates);
		assert.equal(free.get("2026-06-11")?.[0].wholeDay, true);
	});

	/**
	 * The reader unticked work, so the strip draws nothing on the 10th. They are
	 * still in meetings all morning, and "Free all day" would be the one thing
	 * this view must never say.
	 */
	it("takes hours out of a day the strip is drawing nothing on", () => {
		const free = freeStretchesByDate(dates, [
			{ start: at("2026-06-10", "09:00"), end: at("2026-06-10", "12:00") },
			{ start: at("2026-06-10", "13:00"), end: at("2026-06-10", "16:00") },
		]);
		assert.deepEqual(clocks(free.get("2026-06-10") ?? []), ["16–22"]);
		assert.equal(free.get("2026-06-10")?.[0].wholeDay, false);
	});

	it("is the rule `@remit/ui` states, applied to those spans", () => {
		const spans = [{ from: 9 * 60, to: 12 * 60 }];
		const free = freeStretchesByDate(dates, [
			{ start: at("2026-06-10", "09:00"), end: at("2026-06-10", "12:00") },
		]);
		assert.deepEqual(
			free.get("2026-06-10"),
			freeStretchesFromSpans("2026-06-10", spans),
		);
	});
});
