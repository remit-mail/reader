import { FilterClauseField, FilterScope } from "@remit/domain-enums";
import type { FilterItem } from "./types.js";

/**
 * The `Filter` model's sentinel for "this rule takes no such action" — the
 * value `actionLabelId` and `actionMailboxId` hold when a filter applies no
 * label and moves nothing (RFC 034 Decision 3.1).
 */
export const FILTER_NO_ACTION = "None";

/**
 * A standing rule that names senders and does nothing else.
 *
 * That combination has exactly one meaning. The index-time filter pipeline
 * skips a filter with no label and no move, so such a rule changes nothing
 * about where mail lands or how it is tagged; the only thing it can express is
 * the user saying "not from this sender". `dismiss{muteSender:true}` writes
 * one, and the calendar-suggestion producer reads it.
 *
 * Structural, never name-matching: the rule is recognised by its shape, so a
 * rename in the settings UI cannot quietly un-mute a sender.
 */
export const isSenderMuteFilter = (
	filter: Pick<
		FilterItem,
		"scope" | "literalClauses" | "actionLabelId" | "actionMailboxId"
	>,
): boolean =>
	filter.scope === FilterScope.Standing &&
	filter.actionLabelId === FILTER_NO_ACTION &&
	filter.actionMailboxId === FILTER_NO_ACTION &&
	filter.literalClauses.length > 0 &&
	filter.literalClauses.every(
		(clause) =>
			clause.field === FilterClauseField.From && clause.value.trim() !== "",
	);

const fold = (value: string): string => value.trim().toLowerCase();

/**
 * Whether one of these rules mutes an address. Compared case-insensitively and
 * whole: a mail address is one value, and a substring match would let a rule
 * about `ada@example.com` silence `not-ada@example.com.evil.test`.
 */
export const isSenderMuted = (
	filters: readonly Pick<
		FilterItem,
		"scope" | "literalClauses" | "actionLabelId" | "actionMailboxId"
	>[],
	sender: string,
): boolean => {
	const wanted = fold(sender);
	if (wanted === "") return false;
	return filters.some(
		(filter) =>
			isSenderMuteFilter(filter) &&
			filter.literalClauses.some((clause) => fold(clause.value) === wanted),
	);
};
