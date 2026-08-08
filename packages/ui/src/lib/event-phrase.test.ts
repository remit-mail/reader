import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addMinutesToClock, parseEventPhrase } from "./event-phrase.js";

/** Wednesday 10 June 2026, 09:30 local — the fixtures' fixed "now". */
const NOW = new Date(2026, 5, 10, 9, 30);

describe("parseEventPhrase", () => {
	it("reads a title, a guest, a weekday and a time", () => {
		const parse = parseEventPhrase("lunch with Jane friday 1pm", NOW);
		assert.equal(parse.title, "lunch");
		assert.deepEqual(parse.attendees, ["Jane"]);
		assert.equal(parse.date, "2026-06-12");
		assert.equal(parse.startTime, "13:00");
		assert.equal(parse.dateText, "friday");
		assert.equal(parse.startTimeText, "1pm");
	});

	it("assumes an hour when no length is given, and says so", () => {
		const parse = parseEventPhrase("standup tomorrow 9:30", NOW);
		assert.equal(parse.date, "2026-06-11");
		assert.equal(parse.startTime, "09:30");
		assert.equal(parse.durationMinutes, 60);
		assert.deepEqual(parse.assumptions, ["No length given — using an hour"]);
	});

	it("reads an explicit length instead of assuming one", () => {
		const parse = parseEventPhrase("dentist next tuesday 15:00 for 45m", NOW);
		assert.equal(parse.title, "dentist");
		assert.equal(parse.date, "2026-06-23");
		assert.equal(parse.durationMinutes, 45);
		assert.deepEqual(parse.assumptions, []);
	});

	it("splits several guests", () => {
		const parse = parseEventPhrase("coffee with Marcus and Dana thu 8am", NOW);
		assert.equal(parse.title, "coffee");
		assert.deepEqual(parse.attendees, ["Marcus", "Dana"]);
		assert.equal(parse.date, "2026-06-11");
		assert.equal(parse.startTime, "08:00");
	});

	it("reports a missing time rather than inventing one", () => {
		const parse = parseEventPhrase("design review monday", NOW);
		assert.equal(parse.startTime, "");
		assert.deepEqual(parse.unresolved, ["No time given"]);
	});

	it("reports the day it fell back to", () => {
		const parse = parseEventPhrase("call the plumber 3pm", NOW);
		assert.equal(parse.date, "2026-06-10");
		assert.deepEqual(parse.assumptions[0], "No day given — using today");
	});

	it("reads a named hour", () => {
		const parse = parseEventPhrase("sandwich noon", NOW);
		assert.equal(parse.startTime, "12:00");
		assert.equal(parse.title, "sandwich");
	});

	it("has nothing to report on an empty phrase but the gaps", () => {
		const parse = parseEventPhrase("", NOW);
		assert.deepEqual(parse.unresolved, ["No title yet", "No time given"]);
	});

	it("keeps the same weekday when it is today", () => {
		const parse = parseEventPhrase("retro wednesday 4pm", NOW);
		assert.equal(parse.date, "2026-06-10");
	});

	it("reads hours as well as minutes", () => {
		const parse = parseEventPhrase("workshop friday 10am 2h", NOW);
		assert.equal(parse.durationMinutes, 120);
	});
});

describe("addMinutesToClock", () => {
	it("advances a clock", () => {
		assert.equal(addMinutesToClock("13:00", 90), "14:30");
	});

	it("wraps past midnight", () => {
		assert.equal(addMinutesToClock("23:30", 60), "00:30");
	});

	it("returns nothing for no clock", () => {
		assert.equal(addMinutesToClock("", 60), "");
	});
});
