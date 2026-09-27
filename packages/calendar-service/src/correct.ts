import type { CalendarSuggestionItem } from "@remit/data-ports";
import { CalendarInviteMethod, RecurrenceScope } from "@remit/domain-enums";
import type { CalendarEventFields } from "./build.js";
import { type CalendarResult, calendarFailure } from "./errors.js";
import { parseCalendar } from "./parse.js";
import { applyScopedUpdate } from "./scope.js";

export const correctCalendarSuggestion = async (
	suggestion: CalendarSuggestionItem,
	patch: Partial<CalendarEventFields>,
	collectionTimezone: string,
): Promise<CalendarResult<CalendarSuggestionItem>> => {
	if (suggestion.method === CalendarInviteMethod.Cancel) {
		return calendarFailure(
			"UneditableCancellation",
			"a cancellation names no event to correct — add it or dismiss it as it is",
		);
	}

	const parsed = await parseCalendar(suggestion.icalData);
	if (!parsed.ok) return parsed;

	const edited = await applyScopedUpdate(
		parsed.value,
		collectionTimezone,
		{ scope: RecurrenceScope.All, recurrenceId: "", followingUid: "" },
		patch,
	);
	if (!edited.ok) return edited;
	if (edited.value.kind !== "Replace") {
		throw new Error(
			`an edit to the whole invitation resolved to a ${edited.value.kind}`,
		);
	}

	return {
		ok: true,
		value: { ...suggestion, icalData: edited.value.icalData },
	};
};
