import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The phone brief must mount the same selection surface the multi-pane list
 * does (#203). `BriefPane` wires the bulk verbs and the selection bar into
 * `DailyBrief` from the `BriefList` slot; the phone view used to render
 * `DailyBrief` directly, without `onDeleteMessages`, so a selection made in the
 * brief on a phone raised no action bar — selectable, but nothing to act with.
 *
 * As with `MessageList.selection.test.ts`, `BriefPane` weaves routing and
 * several data hooks together, so the rule is enforced by reading the source:
 * the phone view reuses the list slot rather than a bare `DailyBrief`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "BriefPane.tsx"), "utf8");

const briefPhoneBody = (): string => {
	const start = source.indexOf("function BriefPhone(");
	assert.notEqual(start, -1, "BriefPhone is defined");
	const next = source.indexOf("\nfunction ", start + 1);
	return source.slice(start, next === -1 ? undefined : next);
};

describe("BriefPane phone selection surface (#203)", () => {
	it("the phone brief reuses the list slot, not a bare DailyBrief", () => {
		const body = briefPhoneBody();
		assert.match(
			body,
			/<BriefList \/>/,
			"phone brief renders the list slot that wires the bulk verbs",
		);
		assert.doesNotMatch(
			body,
			/<DailyBrief\b/,
			"phone brief must not render DailyBrief directly — that drops onDeleteMessages and the selection bar with it",
		);
	});

	it("the list slot hands DailyBrief the delete verb the selection bar gates on", () => {
		const start = source.indexOf("function BriefList(");
		assert.notEqual(start, -1, "BriefList is defined");
		const next = source.indexOf("\nfunction ", start + 1);
		const body = source.slice(start, next === -1 ? undefined : next);
		assert.match(body, /onDeleteMessages=\{onDeleteMessages\}/);
		assert.match(body, /onMarkMessagesRead=\{onMarkMessagesRead\}/);
	});
});
