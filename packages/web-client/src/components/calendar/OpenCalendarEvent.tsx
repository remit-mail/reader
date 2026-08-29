import {
	type EventDraft,
	type RecurrenceScope,
	RecurrenceScopePrompt,
} from "@remit/ui";
import { useState } from "react";
import { CalendarComposePane } from "@/components/calendar/CalendarComposePane";
import { CalendarEventPane } from "@/components/calendar/CalendarEventPane";
import {
	type CalendarWriteOutcome,
	calendarInstanceId,
	deviceTimeZone,
	draftFromEvent,
	patchFromDrafts,
	rruleFromIcalData,
	type ScopedWrite,
	textFromIcalData,
	textFromRrule,
	useCalendarEvent,
	useCalendars,
	useCalendarWrites,
} from "@/hooks/calendar";
import { useCalendarData } from "@/hooks/useCalendarData";
import { formatEventWhen } from "@/lib/calendar-format";
import { useCalendarAddress, useCalendarNavigation } from "@/routing";

/**
 * The event the address names, resolved — and everything a reader can do to it.
 *
 * The two event routes differ only in what the address says, so the lookup, the
 * scope question and the way back live here once rather than in each of them.
 *
 * An edit or a delete on a repeating event asks which occurrences it means
 * before the form opens, not on the way out: which instances it reaches changes
 * what the change is, so it is settled while it can still be answered.
 *
 * Every write carries the etag of the version on screen. A 412 means somebody
 * replaced the event in between, and it is said out loud rather than resolved
 * by overwriting them.
 */
export interface OpenCalendarEventProps {
	calendarObjectId: string;
	/** One occurrence of a series, absent on the series itself. */
	recurrenceId?: string;
}

const CONFLICT =
	"This event changed somewhere else — over CalDAV, or in another tab. Nothing was saved. Close it and open it again to see the version that's stored now.";

type Intent = "edit" | "delete";

export function OpenCalendarEvent({
	calendarObjectId,
	recurrenceId,
}: OpenCalendarEventProps) {
	const { view, date, calendarIds } = useCalendarAddress();
	const { events } = useCalendarData({ view, date, calendarIds });
	const { calendars, timeZoneByCalendarId } = useCalendars();
	const { closeEvent } = useCalendarNavigation();
	const { updateEvent, deleteEvent, isWriting } = useCalendarWrites();

	const event = events.find(
		(candidate) =>
			candidate.id === calendarInstanceId(calendarObjectId, recurrenceId ?? ""),
	);
	const calendar = calendars.find(
		(candidate) => candidate.id === event?.calendarId,
	);
	const { resource } = useCalendarEvent(
		calendarObjectId,
		event?.calendarId ?? "",
	);

	const [asking, setAsking] = useState<Intent | undefined>(undefined);
	const [editing, setEditing] = useState<
		{ before: EventDraft; scope: RecurrenceScope | undefined } | undefined
	>(undefined);
	const [draft, setDraft] = useState<EventDraft | undefined>(undefined);
	const [problem, setProblem] = useState("");

	const stored = resource ? textFromIcalData(resource.icalData) : undefined;
	const rrule = resource ? rruleFromIcalData(resource.icalData) : "";
	const startTime = event && !event.allDay ? event.start.slice(11, 16) : "";
	const repeat =
		rrule === "" ? "" : (textFromRrule(rrule, startTime) ?? "Repeats");

	// Scoping needs the occurrence to anchor at, so it is offered only where the
	// address names one. A series opened by itself has one honest answer, which
	// is the whole of it.
	const canScope =
		event !== undefined &&
		event.seriesId !== "" &&
		recurrenceId !== undefined &&
		recurrenceId !== "";
	// Until the resource is read there is no etag, and a write with no etag is a
	// write that can silently overwrite somebody.
	const writable = event !== undefined && resource !== undefined;

	const settle = (outcome: CalendarWriteOutcome, done: () => void) => {
		if (outcome.kind === "written") {
			setProblem("");
			done();
			return;
		}
		setProblem(outcome.kind === "conflict" ? CONFLICT : outcome.message);
	};

	const write = (scope: RecurrenceScope | undefined): ScopedWrite => ({
		calendarObjectId,
		calendarId: event?.calendarId ?? "",
		recurrenceId: recurrenceId ?? "",
		scope,
		etag: resource?.etag ?? "",
	});

	const startEdit = (scope: RecurrenceScope | undefined) => {
		if (!event) return;
		const before = draftFromEvent(event, {
			repeat,
			location: stored?.location ?? "",
			notes: stored?.description ?? "",
		});
		setAsking(undefined);
		setEditing({ before, scope });
		setDraft(before);
		setProblem("");
	};

	const removeEvent = (scope: RecurrenceScope | undefined) => {
		setAsking(undefined);
		void deleteEvent(write(scope)).then((outcome) =>
			settle(outcome, closeEvent),
		);
	};

	const saveEdit = () => {
		if (!editing || !draft) return;
		const patch = patchFromDrafts(
			editing.before,
			draft,
			timeZoneByCalendarId[draft.calendarId] ?? deviceTimeZone(),
		);
		if (!patch.ok) {
			setProblem(patch.problem);
			return;
		}
		void updateEvent(write(editing.scope), patch.patch).then((outcome) =>
			settle(outcome, () => {
				setEditing(undefined);
				setDraft(undefined);
			}),
		);
	};

	if (asking !== undefined && event) {
		return (
			<div className="flex h-full flex-col justify-center bg-surface px-row-inset">
				<RecurrenceScopePrompt
					className="mx-auto w-full max-w-md"
					title={event.title}
					ruleText={repeat === "" ? "It repeats" : repeat}
					instanceText={formatEventWhen(event)}
					onChoose={asking === "edit" ? startEdit : removeEvent}
					onCancel={() => setAsking(undefined)}
				/>
			</div>
		);
	}

	if (editing && draft) {
		return (
			<CalendarComposePane
				title="Edit event"
				subtitle={
					editing.scope === "this" ? "This occurrence only" : draft.date
				}
				calendars={calendars}
				draft={draft}
				onChange={setDraft}
				problem={problem}
				saveLabel="Save"
				isSaving={isWriting}
				repeatEditable={editing.scope === undefined || editing.scope === "all"}
				calendarEditable={false}
				onSave={saveEdit}
				onCancel={() => {
					setEditing(undefined);
					setDraft(undefined);
					setProblem("");
				}}
			/>
		);
	}

	return (
		<CalendarEventPane
			event={
				event && {
					...event,
					location: stored?.location ?? "",
					notes: stored?.description ?? "",
					recurrenceRule: repeat,
				}
			}
			calendar={calendar}
			isOccurrence={recurrenceId !== undefined}
			problem={problem}
			onEdit={
				writable
					? () => (canScope ? setAsking("edit") : startEdit(undefined))
					: undefined
			}
			onDelete={
				writable
					? () => (canScope ? setAsking("delete") : removeEvent(undefined))
					: undefined
			}
			onClose={closeEvent}
		/>
	);
}
