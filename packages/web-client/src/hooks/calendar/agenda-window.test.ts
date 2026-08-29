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
	weekKeyOf,
	weekWindowsOver,
} from "./agenda-window.js";
import { calendarWindow, startOfDay } from "./window.js";

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

/**
 * The range is not a window. A read may not cover more than a year
 * (`CALENDAR_MAX_WINDOW_DAYS`), and the strip's range grows every time the
 * reader reaches an end, so the range names weeks to fetch rather than being
 * one request that eventually gets refused.
 */
describe("the weeks a range is fetched as", () => {
	it("is the grid's own window for each week, once each", () => {
		const windows = weekWindowsOver(datesInRange(rangeAround(DATE)));
		for (const window of windows) {
			assert.deepEqual(
				window,
				calendarWindow("week", window.from.slice(0, 10)),
			);
		}
		assert.equal(new Set(windows.map((w) => w.from)).size, windows.length);
	});

	it("covers every day the strip holds and nothing before or after", () => {
		const dates = datesInRange(rangeAround(DATE));
		const held = new Set(weekWindowsOver(dates).map((window) => window.from));
		for (const date of dates) assert.ok(held.has(weekKeyOf(date)));
	});

	it("names the week a day belongs to, Monday to Monday", () => {
		// 2026-06-10 is a Wednesday; its week opens on the 8th.
		assert.equal(weekKeyOf("2026-06-10"), startOfDay("2026-06-08"));
		assert.equal(weekKeyOf("2026-06-08"), startOfDay("2026-06-08"));
		assert.equal(weekKeyOf("2026-06-14"), startOfDay("2026-06-08"));
		assert.equal(weekKeyOf("2026-06-15"), startOfDay("2026-06-15"));
	});

	it("asks for one week however far the reader scrolls", () => {
		// Past the server's 366-day ceiling in both directions.
		let range = rangeAround(DATE);
		for (let reach = 0; reach < 30; reach += 1) {
			range = extendRangeEnd(extendRangeStart(range));
		}
		const dates = datesInRange(range);
		assert.ok(dates.length > 366, "the range never grew past the ceiling");

		for (const window of weekWindowsOver(dates)) {
			const days =
				(Date.parse(window.to) - Date.parse(window.from)) / 86_400_000;
			assert.equal(days, 7, `a window covered ${days} days`);
		}
	});

	it("grows by adding weeks rather than by widening one", () => {
		const opening = weekWindowsOver(datesInRange(rangeAround(DATE)));
		const wider = weekWindowsOver(
			datesInRange(extendRangeStart(rangeAround(DATE))),
		);
		const kept = new Set(wider.map((window) => window.from));
		for (const window of opening) {
			assert.ok(kept.has(window.from), `${window.from} was given up`);
		}
		assert.ok(wider.length > opening.length);
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
