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
import { type CalendarEventData, type EventDraft, lastDayOf } from "@remit/ui";
import { moveRule, rruleFromText } from "./recurrence-rule";
import { addDays, isoAtInZone, isoOnClock } from "./window";

export type DraftRefusal = { ok: false; problem: string };

/**
 * The two zones a write needs. `clock` is the one the form's digits were read
 * on — the device's, which every surface draws on — and it decides the offset,
 * so the instant saved is the instant shown. `anchor` is the zone the event is
 * stored in, written as the TZID a series keeps its wall time in across a DST
 * change (`anchorZoneFor`); `""` anchors it in UTC.
 */
export interface DraftZones {
	clock: string;
	anchor: string;
}

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
		endDate: date,
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
		endDate: lastDayOf(event),
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
 * The draft's wall clock, pinned to an instant on the clock it was read on.
 * Stamping any other zone's offset onto those digits moves the event by the
 * difference between the two — silently, and only for whoever is travelling.
 */
function timesFor(
	draft: EventDraft,
	clock: string,
): { start: string; end: string } {
	if (draft.allDay)
		return { start: draft.date, end: addDays(draft.endDate, 1) };
	return {
		start: isoAtInZone(draft.date, draft.startTime, clock),
		end: isoAtInZone(draft.endDate, draft.endTime, clock),
	};
}

/**
 * The picked rule, stored on the day the event's own zone starts it on rather
 * than on the day the device showed when it was picked.
 */
function storedRule(
	draft: EventDraft,
	start: string,
	zones: DraftZones,
): string {
	const rule = rruleFromText(draft.repeat) ?? "";
	const anchorDate = draft.allDay
		? draft.date
		: isoOnClock(start, zones.anchor === "" ? "UTC" : zones.anchor).slice(
				0,
				10,
			);
	return moveRule(rule, draft.date, anchorDate);
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
	if (draft.endDate === "") return "Pick the day the event ends on.";
	if (draft.calendarId === "") return "Pick the calendar to save the event in.";
	if (!draft.allDay && (draft.startTime === "" || draft.endTime === ""))
		return "Set a start and an end time, or mark the event all day.";
	if (draft.allDay && draft.endDate < draft.date)
		return "The last day is before the first. Move one of them.";
	if (
		!draft.allDay &&
		`${draft.endDate}T${draft.endTime}` <= `${draft.date}T${draft.startTime}`
	)
		return "The end is not after the start. Move one of them.";
	if (checkRepeat && rruleFromText(draft.repeat) === undefined)
		return "This calendar can't store that repeat rule. Pick one of the offered rules, or turn the repeat off.";
	return "";
}

export function createInputFromDraft(
	draft: EventDraft,
	zones: DraftZones,
): CreateInput {
	const problem = refuse(draft, true);
	if (problem !== "") return { ok: false, problem };
	const { start, end } = timesFor(draft, zones.clock);
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
			...(zones.anchor === "" ? {} : { timeZone: zones.anchor }),
			recurrenceRule: storedRule(draft, start, zones),
		},
	};
}

export function patchFromDrafts(
	before: EventDraft,
	after: EventDraft,
	zones: DraftZones,
): UpdatePatch {
	const repeatChanged = after.repeat !== before.repeat;
	const allDayChanged = after.allDay !== before.allDay;
	const startMoved =
		allDayChanged ||
		after.date !== before.date ||
		after.startTime !== before.startTime;
	const endMoved =
		startMoved ||
		after.endDate !== before.endDate ||
		after.endTime !== before.endTime;
	const problem = refuse(after, repeatChanged);
	if (problem !== "") return { ok: false, problem };

	const patch: RemitImapUpdateCalendarEventInput = {};
	if (after.title.trim() !== before.title.trim())
		patch.summary = after.title.trim();
	if (after.location !== before.location) patch.location = after.location;
	if (after.notes !== before.notes) patch.description = after.notes;

	const { start, end } = timesFor(after, zones.clock);
	if (startMoved) patch.start = start;
	if (endMoved) {
		patch.end = end;
		patch.allDay = after.allDay;
		// The offset pins the instant; the zone is what a series needs to keep
		// meeting at nine when the clocks go back.
		if (zones.anchor !== "") patch.timeZone = zones.anchor;
	}

	if (repeatChanged) patch.recurrenceRule = storedRule(after, start, zones);

	return { ok: true, patch };
}
