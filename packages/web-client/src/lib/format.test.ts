import assert from "node:assert";
import { describe, test } from "node:test";
import {
	deleteConfirmationCopy,
	deleteOutcomeFor,
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

	test("thousands-separates an escalated-selection-scale count", () => {
		assert.strictEqual(
			formatDeleteToTrashTitle(3412),
			"Move 3,412 messages to Trash?",
		);
	});
});

describe("deleteConfirmationCopy", () => {
	test("asks to move when the delete files the mail in Trash", () => {
		assert.deepStrictEqual(deleteConfirmationCopy(3, "trash"), {
			title: "Move 3 messages to Trash?",
			description: "You can restore them from Trash later.",
			confirmLabel: "Move to Trash",
		});
	});

	test("asks about destruction when the delete expunges", () => {
		assert.deepStrictEqual(deleteConfirmationCopy(3, "permanent"), {
			title: "Permanently delete 3 messages?",
			description:
				"They are erased from the mail server and cannot be restored.",
			confirmLabel: "Delete permanently",
		});
	});

	test("uses the singular noun for one message on the permanent path", () => {
		assert.strictEqual(
			deleteConfirmationCopy(1, "permanent").title,
			"Permanently delete 1 message?",
		);
	});

	test("commits to neither wording until the Trash appointment resolves", () => {
		assert.deepStrictEqual(deleteConfirmationCopy(3, "unknown"), {
			title: "Delete 3 messages?",
			description: "Checking where this account files deleted mail…",
			confirmLabel: "Delete",
		});
	});
});

/**
 * Issue #855. The failure branch is the one that matters: TanStack sets
 * `status: "error"` with `data` undefined, so a config read that failed leaves
 * an empty Trash set behind. Reading that as "this folder is not Trash" hands an
 * expired session a "Move to Trash?" dialog over an expunge — #845 reinstated on
 * the error path.
 */
describe("deleteOutcomeFor", () => {
	const trashByAccount = new Map([
		["acct-1", "mbx-trash"],
		["acct-2", undefined],
	]);
	const settled = { trashByAccount, hasAppointments: true, isError: false };
	const target = (
		mailboxId: string,
		accountId: string | undefined = "acct-1",
	) => ({
		accountId,
		mailboxId,
	});

	test("a row outside Trash is a reversible move", () => {
		assert.strictEqual(
			deleteOutcomeFor({ ...settled, targets: [target("mbx-inbox")] }),
			"trash",
		);
	});

	test("a row inside its own account's Trash is an expunge", () => {
		assert.strictEqual(
			deleteOutcomeFor({ ...settled, targets: [target("mbx-trash")] }),
			"permanent",
		);
	});

	test("one row inside Trash makes a mixed set permanent", () => {
		assert.strictEqual(
			deleteOutcomeFor({
				...settled,
				targets: [target("mbx-inbox"), target("mbx-trash")],
			}),
			"permanent",
		);
	});

	test("an account that appoints no Trash is its own answer, not a move", () => {
		assert.strictEqual(
			deleteOutcomeFor({
				...settled,
				targets: [target("mbx-inbox", "acct-2")],
			}),
			"noTrash",
			"the server refuses that delete rather than moving anything",
		);
	});

	test("a refused account outranks an expunge in the same set", () => {
		assert.strictEqual(
			deleteOutcomeFor({
				...settled,
				targets: [target("mbx-trash"), target("mbx-inbox", "acct-2")],
			}),
			"noTrash",
		);
	});

	test("another account's Trash is not this row's Trash", () => {
		assert.strictEqual(
			deleteOutcomeFor({
				...settled,
				trashByAccount: new Map([
					["acct-1", "mbx-trash"],
					["acct-2", "mbx-other-trash"],
				]),
				targets: [target("mbx-trash", "acct-2")],
			}),
			"trash",
		);
	});

	test("appointments that have not arrived commit to neither wording", () => {
		assert.strictEqual(
			deleteOutcomeFor({
				targets: [target("mbx-inbox")],
				trashByAccount: new Map(),
				hasAppointments: false,
				isError: false,
			}),
			"unknown",
			"a paused offline query reports neither loading nor error",
		);
	});

	test("an account nothing is known about yet is unknown, not a move", () => {
		assert.strictEqual(
			deleteOutcomeFor({
				...settled,
				targets: [target("mbx-inbox", "acct-9")],
			}),
			"unknown",
		);
	});

	test("a row with no account is unknown, not a move", () => {
		assert.strictEqual(
			deleteOutcomeFor({
				...settled,
				targets: [target("mbx-inbox", undefined)],
			}),
			"unknown",
		);
	});

	test("a failed read refuses the delete rather than promising a move", () => {
		assert.strictEqual(
			deleteOutcomeFor({
				targets: [target("mbx-inbox")],
				trashByAccount: new Map(),
				hasAppointments: false,
				isError: true,
			}),
			"unavailable",
		);
	});

	test("a failed read outranks a settled appointment set", () => {
		assert.strictEqual(
			deleteOutcomeFor({
				...settled,
				targets: [target("mbx-inbox")],
				isError: true,
			}),
			"unavailable",
		);
	});

	test("nothing pending is not an answer", () => {
		assert.strictEqual(
			deleteOutcomeFor({ ...settled, targets: [] }),
			"unknown",
		);
	});
});

describe("deleteConfirmationCopy — the refusal", () => {
	test("states what failed and offers the way back in", () => {
		assert.deepStrictEqual(deleteConfirmationCopy(1, "unavailable"), {
			title: "Can't delete 1 message",
			description:
				"reader couldn't read this account's folder settings, so it can't say whether this would move the mail to Trash or erase it. Nothing has been deleted.",
			confirmLabel: "Sign in again",
		});
	});

	test("never offers the reversible wording on the failure path", () => {
		const copy = deleteConfirmationCopy(3, "unavailable");
		assert.ok(!copy.title.includes("Move"));
		assert.ok(!copy.description.includes("restore"));
	});

	test("sends an unappointed Trash to the screen that appoints one", () => {
		const copy = deleteConfirmationCopy(3, "noTrash");
		assert.strictEqual(copy.title, "Can't delete 3 messages");
		assert.match(copy.description, /appointed as Trash/);
		assert.strictEqual(copy.confirmLabel, "Open folder settings");
	});

	test("never promises a restore when no Trash is appointed", () => {
		const copy = deleteConfirmationCopy(3, "noTrash");
		assert.ok(!copy.title.includes("Move"));
		assert.ok(!copy.description.includes("restore"));
	});
});
