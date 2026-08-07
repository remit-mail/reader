/**
 * The phrasings the Option C stories demonstrate. The stories are where this is
 * judged, so a phrase that reads correctly in the workbench has to keep reading
 * correctly — the readings on screen are the argument, and a silent regression
 * in one of them would show up as the reader quietly guessing again.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgendaPhrase } from "./agenda-phrase.js";

/** Wednesday 10 June 2026, 09:30 — the fixtures' fixed now. */
const NOW = new Date(2026, 5, 10, 9, 30);

describe("parseAgendaPhrase", () => {
	it("reads a title, a guest, a weekday and a clock time", () => {
		const parse = parseAgendaPhrase("lunch with Jane friday 1pm", NOW);
		assert.equal(parse.title, "lunch");
		assert.deepEqual(parse.attendees, ["Jane"]);
		assert.equal(parse.date, "2026-06-12");
		assert.equal(parse.startTime, "13:00");
		assert.equal(parse.endTime, "14:00");
	});

	it("offers both readings of a bare weekday rather than picking one", () => {
		const parse = parseAgendaPhrase("lunch with Jane friday 1pm", NOW);
		const choice = parse.choices.find((item) => item.id === "weekday");
		assert.ok(choice);
		assert.deepEqual(
			choice.options.map((option) => option.date),
			["2026-06-12", "2026-06-19"],
		);
	});

	it("applies the answer to an open reading", () => {
		const parse = parseAgendaPhrase("lunch with Jane friday 1pm", NOW, {
			weekday: "later",
		});
		assert.equal(parse.date, "2026-06-19");
	});

	it("reads a repeat rule and says it has no end", () => {
		const parse = parseAgendaPhrase("standup every weekday 9:30", NOW);
		assert.equal(parse.repeat, "Every weekday");
		assert.equal(parse.title, "standup");
		assert.equal(parse.startTime, "09:30");
		assert.ok(
			parse.unresolved.some((note) => note.includes("no end")),
			"a repeat with no end has to be said out loud",
		);
	});

	it("keeps the weekday a repeat is anchored to", () => {
		const parse = parseAgendaPhrase("review every tuesday 4pm", NOW);
		assert.equal(parse.repeat, "Every Tuesday");
		assert.equal(parse.date, "2026-06-16");
		assert.equal(parse.startTime, "16:00");
	});

	it("asks which eight a bare hour means", () => {
		const parse = parseAgendaPhrase("coffee with Marcus at 8", NOW);
		const choice = parse.choices.find((item) => item.id === "hour");
		assert.ok(choice);
		assert.equal(parse.startTime, "08:00");
		assert.equal(
			parseAgendaPhrase("coffee with Marcus at 8", NOW, { hour: "evening" })
				.startTime,
			"20:00",
		);
	});

	it("reads a range, a calendar date and a place out of one line", () => {
		const parse = parseAgendaPhrase(
			"team lunch 12:30-14:00 june 17 @ Toscanini",
			NOW,
		);
		assert.equal(parse.title, "team lunch");
		assert.equal(parse.date, "2026-06-17");
		assert.equal(parse.startTime, "12:30");
		assert.equal(parse.endTime, "14:00");
		assert.equal(parse.durationMinutes, 90);
		assert.equal(parse.location, "Toscanini");
		assert.deepEqual(parse.unresolved, []);
	});

	it("carries a meridiem across a range that only names it once", () => {
		const parse = parseAgendaPhrase("call 1-2pm", NOW);
		assert.equal(parse.startTime, "13:00");
		assert.equal(parse.endTime, "14:00");
	});

	it("leaves the kit's own readings alone", () => {
		const parse = parseAgendaPhrase("dentist tomorrow 2pm 45m", NOW);
		assert.equal(parse.date, "2026-06-11");
		assert.equal(parse.startTime, "14:00");
		assert.equal(parse.endTime, "14:45");
		assert.equal(parse.repeat, "");
	});
});
