import assert from "node:assert";
import { describe, test } from "node:test";
import {
	formatDate,
	formatDatePreset,
	formatDeleteToTrashTitle,
	formatEmailDate,
	formatRelativeTime,
} from "./format.js";

// null/undefined can arrive at runtime even though the type forbids them.
const invalidInputs: Array<[string, unknown]> = [
	["Invalid Date", new Date("nope")],
	["null", null],
	["undefined", undefined],
	["empty string", ""],
	["whitespace string", "   "],
	["unparseable string", "not-a-date"],
];

describe("date formatters render invalid input as empty instead of throwing", () => {
	for (const [label, value] of invalidInputs) {
		test(`formatDate(${label})`, () => {
			assert.strictEqual(
				formatDate(value as Parameters<typeof formatDate>[0]),
				"",
			);
		});
		test(`formatDatePreset(${label})`, () => {
			assert.strictEqual(
				formatDatePreset(
					value as Parameters<typeof formatDatePreset>[0],
					"medium",
				),
				"",
			);
		});
		test(`formatRelativeTime(${label})`, () => {
			assert.strictEqual(
				formatRelativeTime(value as Parameters<typeof formatRelativeTime>[0]),
				"",
			);
		});
		test(`formatEmailDate(${label})`, () => {
			assert.strictEqual(
				formatEmailDate(value as Parameters<typeof formatEmailDate>[0]),
				"",
			);
		});
	}
});

describe("date formatters render valid input", () => {
	const epochMs = Date.UTC(2023, 0, 17, 12, 0, 0);

	test("epoch 0 is a valid date, not a fallback", () => {
		assert.notStrictEqual(formatDate(0), "");
	});

	test("a Date, an epoch number, and the same epoch as a string agree", () => {
		const fromNumber = formatDate(epochMs, { year: "numeric" });
		const fromDate = formatDate(new Date(epochMs), { year: "numeric" });
		const fromString = formatDate(String(epochMs), { year: "numeric" });
		assert.strictEqual(fromNumber, "2023");
		assert.strictEqual(fromDate, "2023");
		assert.strictEqual(fromString, "2023");
	});

	test("formatRelativeTime renders a non-empty label for a recent date", () => {
		assert.notStrictEqual(formatRelativeTime(Date.now() - 60_000), "");
	});

	test("an ISO string with separators goes through the Date parser, not the epoch branch", () => {
		// The /^-?\d+$/ guard only matches pure digits, so a real business date
		// string (with "-", "T", ":", "+") is parsed as a date, never as an epoch.
		assert.strictEqual(
			formatDate("2026-07-07T12:34:56+02:00", {
				year: "numeric",
				timeZone: "UTC",
			}),
			"2026",
		);
	});

	test("an all-digit string is read as epoch MILLISECONDS", () => {
		// toDate does Number(msString); a 13-digit value is milliseconds.
		// Seconds-based sources must pre-multiply by 1000 at the CALL SITE — a
		// 10-digit seconds value is the caller's responsibility, not toDate's.
		const msString = String(Date.UTC(2023, 0, 17));
		assert.strictEqual(
			formatDate(msString, { year: "numeric", timeZone: "UTC" }),
			"2023",
		);
	});
});

describe("formatDeleteToTrashTitle", () => {
	test("uses the singular noun for one message", () => {
		assert.strictEqual(formatDeleteToTrashTitle(1), "Move 1 message to Trash?");
	});

	test("uses the plural noun and the count for many messages", () => {
		assert.strictEqual(
			formatDeleteToTrashTitle(3),
			"Move 3 messages to Trash?",
		);
	});

	test("treats zero as plural", () => {
		assert.strictEqual(
			formatDeleteToTrashTitle(0),
			"Move 0 messages to Trash?",
		);
	});
});
