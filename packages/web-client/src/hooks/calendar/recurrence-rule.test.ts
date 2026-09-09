/**
 * Repeat rules, both ways.
 *
 * The picker only ever offers the sentences `repeatChoices` derives, so the
 * table has to cover exactly those and refuse everything else — a sentence
 * turned into a rule it does not mean is an event that repeats on days nobody
 * chose, and nothing on screen would say so.
 *
 * A rule written by something else — a native client, an invitation — must come
 * back unread rather than snapped to the nearest sentence.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repeatChoices } from "@remit/ui";
import { rruleFromText, textFromRrule } from "./recurrence-rule";

const DATE = "2026-06-10";
const TIME = "09:15";

describe("every rule the picker offers", () => {
	it("becomes an RRULE, and reads back as the sentence it was picked from", () => {
		for (const choice of repeatChoices(DATE, TIME)) {
			const rule = rruleFromText(choice);
			assert.ok(
				rule !== undefined && rule !== "",
				`no rule for the offered choice "${choice}"`,
			);
			assert.equal(textFromRrule(rule, TIME), choice);
		}
	});

	it("says what each one means", () => {
		assert.equal(rruleFromText("Every day, 09:15"), "FREQ=DAILY");
		assert.equal(
			rruleFromText("Every weekday, 09:15"),
			"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
		);
		assert.equal(
			rruleFromText("Every week on Wednesday, 09:15"),
			"FREQ=WEEKLY;BYDAY=WE",
		);
		assert.equal(
			rruleFromText("Every month on the second Wednesday, 09:15"),
			"FREQ=MONTHLY;BYDAY=2WE",
		);
		assert.equal(
			rruleFromText("Every year on 10 June, 09:15"),
			"FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=10",
		);
	});

	it("reads the last week of a month as the rule that means it", () => {
		assert.equal(
			rruleFromText("Every month on the last Friday"),
			"FREQ=MONTHLY;BYDAY=-1FR",
		);
		assert.equal(
			textFromRrule("FREQ=MONTHLY;BYDAY=-1FR", ""),
			"Every month on the last Friday",
		);
	});
});

describe("no repeat", () => {
	it("is the empty rule rather than a refusal", () => {
		assert.equal(rruleFromText(""), "");
	});
});

describe("a sentence this table does not cover", () => {
	it("is refused rather than guessed at", () => {
		assert.equal(rruleFromText("Every other Tuesday"), undefined);
		assert.equal(rruleFromText("Every week on Caturday"), undefined);
		assert.equal(rruleFromText("Repeats"), undefined);
	});
});

describe("a rule written by something else", () => {
	it("comes back unread rather than snapped to the nearest sentence", () => {
		assert.equal(
			textFromRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", ""),
			undefined,
		);
		assert.equal(textFromRrule("FREQ=DAILY;COUNT=10", ""), undefined);
		assert.equal(
			textFromRrule("FREQ=DAILY;UNTIL=20261231T000000Z", ""),
			undefined,
		);
		assert.equal(textFromRrule("FREQ=HOURLY", ""), undefined);
		assert.equal(textFromRrule("FREQ=WEEKLY", ""), undefined);
	});
});
