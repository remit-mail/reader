/**
 * Which surface a draft reopens in, and when a mode switch is refused.
 *
 * The mode is derived from `htmlBody`, with no field of its own. It has to be
 * "a non-empty string" and not "truthy": the rich editor serializes an empty
 * document to `<p><br></p>` and a plain draft clears the column to `""`, so a
 * falsy check opens a plain draft correctly by accident and an absent column
 * — an old draft, a partial write — the wrong way round.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	conversionOutcome,
	modeOfDraft,
	switchNeedsWarning,
} from "./compose-mode.js";

describe("the mode a draft reopens in", () => {
	it("opens a draft with HTML as rich", () => {
		assert.equal(modeOfDraft("<p>Hello</p>"), "rich");
	});

	it("opens an empty rich document as rich", () => {
		assert.equal(modeOfDraft("<p><br></p>"), "rich");
	});

	it("opens a draft whose HTML was cleared as plain", () => {
		assert.equal(modeOfDraft(""), "plain");
	});

	it("opens a draft that never had HTML as plain", () => {
		assert.equal(modeOfDraft(undefined), "plain");
	});
});

describe("whether the switch warns first", () => {
	it("warns when the document holds formatting", () => {
		assert.equal(switchNeedsWarning("plain", ["table"]), true);
	});

	it("says nothing over plain paragraphs", () => {
		assert.equal(switchNeedsWarning("plain", []), false);
	});

	it("never warns on the way back to rich", () => {
		assert.equal(switchNeedsWarning("rich", ["table", "bold"]), false);
	});
});

describe("a conversion that would empty a written message", () => {
	it("goes ahead when the conversion carried the message across", () => {
		assert.deepEqual(conversionOutcome("plain", "Due Friday.", "Due Friday."), {
			outcome: "switch",
		});
	});

	it("goes ahead when there was nothing to carry", () => {
		assert.deepEqual(conversionOutcome("plain", "", ""), { outcome: "switch" });
	});

	it("refuses, naming the direction, when plain text came back empty", () => {
		assert.deepEqual(conversionOutcome("plain", "Due Friday.", "   "), {
			outcome: "blocked",
			title: "Couldn't switch to plain text",
			detail: "The conversion came back empty, so your message is unchanged.",
		});
	});

	it("refuses, naming the direction, when rich text came back empty", () => {
		assert.deepEqual(conversionOutcome("rich", "Due Friday.", ""), {
			outcome: "blocked",
			title: "Couldn't switch to rich text",
			detail: "The conversion came back empty, so your message is unchanged.",
		});
	});
});
