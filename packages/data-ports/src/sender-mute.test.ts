import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterRuleFromClauses } from "./filter-rule.js";
import { isSenderMuted, isSenderMuteFilter } from "./sender-mute.js";
import type { FilterClauseItem, FilterItem } from "./types.js";

const rule = (
	overrides: Partial<FilterItem> = {},
	literalClauses: FilterClauseItem[] = [
		{ field: "From", value: "ada@example.test" },
	],
): FilterItem =>
	({
		scope: "Standing",
		rule: filterRuleFromClauses({ matchOperator: "And", literalClauses }),
		actionLabelId: "None",
		actionMailboxId: "None",
		...overrides,
	}) as unknown as FilterItem;

describe("isSenderMuteFilter", () => {
	it("recognises a standing rule that names a sender and does nothing", () => {
		assert.equal(isSenderMuteFilter(rule()), true);
	});

	it("declines a rule that applies a label", () => {
		assert.equal(isSenderMuteFilter(rule({ actionLabelId: "label-1" })), false);
	});

	it("declines a rule that moves the message", () => {
		assert.equal(
			isSenderMuteFilter(rule({ actionMailboxId: "mailbox-1" })),
			false,
		);
	});

	it("declines a rule that matches on something other than the sender", () => {
		assert.equal(
			isSenderMuteFilter(rule({}, [{ field: "Subject", value: "invitation" }])),
			false,
		);
	});

	it("declines a rule with no clauses, which would mute everybody", () => {
		assert.equal(isSenderMuteFilter(rule({}, [])), false);
	});

	it("declines a temporary rule", () => {
		assert.equal(isSenderMuteFilter(rule({ scope: "Temporary" })), false);
	});
});

describe("isSenderMuted", () => {
	it("matches an address whatever case either side was written in", () => {
		assert.equal(isSenderMuted([rule()], "Ada@Example.TEST"), true);
	});

	it("matches the whole address, never a substring of one", () => {
		// A rule about ada@example.test must not silence an address that merely
		// contains it — the lookalike is exactly what a spoofer would send from.
		assert.equal(
			isSenderMuted([rule()], "not-ada@example.test.evil.test"),
			false,
		);
	});

	it("says no when nothing names the sender", () => {
		assert.equal(isSenderMuted([rule()], "someone@example.test"), false);
	});

	it("says no for an empty sender rather than matching an empty clause", () => {
		assert.equal(isSenderMuted([rule()], ""), false);
	});

	it("says no with no rules at all", () => {
		assert.equal(isSenderMuted([], "ada@example.test"), false);
	});
});
