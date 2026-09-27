import type {
	RemitImapAcceptCalendarSuggestionInput,
	RemitImapCalendarSuggestionResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { EventDraft } from "@remit/ui";
import {
	type DraftRefusal,
	type DraftZones,
	emptyDraft,
	patchFromDrafts,
	timesFor,
} from "./draft";
import { addDays, isoOnClock } from "./window";

export type AcceptEditedInput =
	| { ok: true; input: RemitImapAcceptCalendarSuggestionInput }
	| DraftRefusal;

type Suggestion = Pick<
	RemitImapCalendarSuggestionResponse,
	"summary" | "location" | "dtStart" | "dtEnd" | "allDay" | "zoneCertainty"
>;

export function draftFromSuggestion(
	suggestion: Suggestion,
	calendarId: string,
	clock: string,
): EventDraft {
	const base = {
		title: suggestion.summary,
		location: suggestion.location,
	};
	if (suggestion.allDay) {
		const date = suggestion.dtStart.slice(0, 10);
		const end = suggestion.dtEnd.slice(0, 10);
		return {
			...emptyDraft(date, calendarId),
			...base,
			allDay: true,
			startTime: "",
			endDate: end > date ? addDays(end, -1) : date,
			endTime: "",
		};
	}
	const wall = (iso: string): string =>
		suggestion.zoneCertainty === "Ambiguous" ? iso : isoOnClock(iso, clock);
	const start = wall(suggestion.dtStart);
	const end = wall(suggestion.dtEnd);
	return {
		...emptyDraft(start.slice(0, 10), calendarId),
		...base,
		startTime: start.slice(11, 16),
		endDate: end.slice(0, 10),
		endTime: end.slice(11, 16),
	};
}

export function acceptEditedInputFromDrafts(
	suggestion: Suggestion,
	seed: EventDraft,
	draft: EventDraft,
	zones: DraftZones,
): AcceptEditedInput {
	const built = patchFromDrafts(seed, draft, zones);
	if (!built.ok) return built;
	const placed =
		suggestion.zoneCertainty === "Ambiguous" || built.patch.start !== undefined;
	const event = placed
		? {
				...built.patch,
				...timesFor(draft, zones.clock),
				allDay: draft.allDay,
				timeZone: zones.anchor,
			}
		: built.patch;
	return { ok: true, input: { calendarId: draft.calendarId, event } };
}
