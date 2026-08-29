/**
 * The editor's draft, and what the API makes of it.
 *
 * A refusal is returned rather than thrown, and it says which field is wrong and
 * what to do about it — a form that only greys its save button leaves the reader
 * hunting for the reason.
 *
 * An edit sends the fields that changed and nothing else. Absence means
 * untouched on this API, so patching every field would write back the empty
 * `location` and `description` a listing never carried and quietly erase them.
 */
import type {
	RemitImapCreateCalendarEventInput,
	RemitImapUpdateCalendarEventInput,
} from "@remit/api-http-client/types.gen.ts";
import type { CalendarEventData, EventDraft } from "@remit/ui";
import { rruleFromText } from "./recurrence-rule";
import { addDays, isoAtInZone } from "./window";

export type DraftRefusal = { ok: false; problem: string };

export type CreateInput =
	| { ok: true; input: RemitImapCreateCalendarEventInput }
	| DraftRefusal;

export type UpdatePatch =
	| { ok: true; patch: RemitImapUpdateCalendarEventInput }
	| DraftRefusal;

/** A blank event, an hour long, at the start of a working day. */
export function emptyDraft(date: string, calendarId: string): EventDraft {
	return {
		title: "",
		date,
		startTime: "09:00",
		endTime: "10:00",
		allDay: false,
		calendarId,
		location: "",
		guests: "",
		notes: "",
		repeat: "",
	};
}

/**
 * The draft an event opens into, so an edit starts from what is stored rather
 * than from what a grid chip had room to draw. The occurrence listing carries
 * neither the location nor the notes, so those come from the resource.
 */
export function draftFromEvent(
	event: CalendarEventData,
	stored: { repeat: string; location: string; notes: string },
): EventDraft {
	return {
		title: event.title,
		date: event.start.slice(0, 10),
		startTime: event.allDay ? "" : event.start.slice(11, 16),
		endTime: event.allDay ? "" : event.end.slice(11, 16),
		allDay: event.allDay,
		calendarId: event.calendarId,
		location: stored.location,
		guests: "",
		notes: stored.notes,
		repeat: stored.repeat,
	};
}

/**
 * The draft's wall clock, pinned to an instant in the calendar's own zone.
 *
 * The zone is the calendar's rather than the device's because that is the clock
 * the times were read on: the listing returns an occurrence in the collection's
 * zone, and the form shows those digits. Stamping the device's offset back onto
 * them moves the event by the difference between the two — silently, and only
 * for whoever is travelling.
 */
function timesFor(
	draft: EventDraft,
	timeZone: string,
): { start: string; end: string } {
	if (draft.allDay) return { start: draft.date, end: addDays(draft.date, 1) };
	return {
		start: isoAtInZone(draft.date, draft.startTime, timeZone),
		end: isoAtInZone(draft.date, draft.endTime, timeZone),
	};
}

/**
 * An unreadable rule is only a refusal where the reader chose it. An event that
 * arrived carrying a rule this client cannot put into words is still editable —
 * the rule is left where it is and every other field saves.
 */
function refuse(draft: EventDraft, checkRepeat: boolean): string {
	if (draft.title.trim() === "")
		return "Give the event a title before saving it.";
	if (draft.date === "") return "Pick the day the event is on.";
	if (draft.calendarId === "") return "Pick the calendar to save the event in.";
	if (!draft.allDay && (draft.startTime === "" || draft.endTime === ""))
		return "Set a start and an end time, or mark the event all day.";
	if (!draft.allDay && draft.endTime <= draft.startTime)
		return "The end time is not after the start time. Move one of them.";
	if (checkRepeat && rruleFromText(draft.repeat) === undefined)
		return "This calendar can't store that repeat rule. Pick one of the offered rules, or turn the repeat off.";
	return "";
}

export function createInputFromDraft(
	draft: EventDraft,
	timeZone: string,
): CreateInput {
	const problem = refuse(draft, true);
	if (problem !== "") return { ok: false, problem };
	const { start, end } = timesFor(draft, timeZone);
	return {
		ok: true,
		input: {
			calendarId: draft.calendarId,
			summary: draft.title.trim(),
			description: draft.notes,
			location: draft.location,
			start,
			end,
			allDay: draft.allDay,
			timeZone,
			recurrenceRule: rruleFromText(draft.repeat) ?? "",
		},
	};
}

export function patchFromDrafts(
	before: EventDraft,
	after: EventDraft,
	timeZone: string,
): UpdatePatch {
	const repeatChanged = after.repeat !== before.repeat;
	const problem = refuse(after, repeatChanged);
	if (problem !== "") return { ok: false, problem };

	const patch: RemitImapUpdateCalendarEventInput = {};
	if (after.title.trim() !== before.title.trim())
		patch.summary = after.title.trim();
	if (after.location !== before.location) patch.location = after.location;
	if (after.notes !== before.notes) patch.description = after.notes;

	const moved =
		after.date !== before.date ||
		after.startTime !== before.startTime ||
		after.endTime !== before.endTime ||
		after.allDay !== before.allDay;
	if (moved) {
		const { start, end } = timesFor(after, timeZone);
		patch.start = start;
		patch.end = end;
		patch.allDay = after.allDay;
		// The offset pins the instant; the zone is what a series needs to keep
		// meeting at nine when the clocks go back.
		patch.timeZone = timeZone;
	}

	if (repeatChanged) patch.recurrenceRule = rruleFromText(after.repeat) ?? "";

	return { ok: true, patch };
}
