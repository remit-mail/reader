/**
 * Reading three properties off a stored resource.
 *
 * RFC 5545 folds a long line by breaking it and indenting the remainder, so a
 * value read line-first stops halfway and looks like a shorter value rather
 * than a broken one — a rule truncated that way turns a weekly meeting into a
 * daily one on screen with nothing to say it happened.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rruleFromIcalData, textFromIcalData } from "./resource";

const ics = (...lines: string[]): string =>
	[
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT",
		...lines,
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

describe("the rule inside a resource", () => {
	it("is read whole across a fold", () => {
		assert.equal(
			rruleFromIcalData(ics("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,", " TH,FR")),
			"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
		);
	});

	it("is empty where the event does not repeat", () => {
		assert.equal(rruleFromIcalData(ics("SUMMARY:Roadmap review")), "");
	});
});

describe("the text a listing does not carry", () => {
	it("comes back unescaped", () => {
		const text = textFromIcalData(
			ics(
				"LOCATION:Room Zuid\\, second floor",
				"DESCRIPTION:Bring the numbers.\\nAnd the slides.",
			),
		);
		assert.equal(text.location, "Room Zuid, second floor");
		assert.equal(text.description, "Bring the numbers.\nAnd the slides.");
	});

	it("reads a property that carries parameters", () => {
		assert.equal(
			textFromIcalData(ics('DESCRIPTION;ALTREP="cid:x":Plain text'))
				.description,
			"Plain text",
		);
	});

	it("takes the master's value rather than an override's", () => {
		const overridden = [
			"BEGIN:VCALENDAR",
			"BEGIN:VEVENT",
			"LOCATION:Room Zuid",
			"END:VEVENT",
			"BEGIN:VEVENT",
			"RECURRENCE-ID:20260610T090000Z",
			"LOCATION:Room Noord",
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n");
		assert.equal(textFromIcalData(overridden).location, "Room Zuid");
	});

	it("is empty where the resource says nothing", () => {
		assert.deepEqual(textFromIcalData(ics("SUMMARY:Standup")), {
			location: "",
			description: "",
		});
	});
});
