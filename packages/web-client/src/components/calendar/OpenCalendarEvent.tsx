import {
	type EventDraft,
	type RecurrenceScope,
	RecurrenceScopePrompt,
} from "@remit/ui";
import { Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuthProvider } from "@/auth/provider";
import { CalendarComposePane } from "@/components/calendar/CalendarComposePane";
import {
	type CalendarEventAbsence,
	CalendarEventPane,
} from "@/components/calendar/CalendarEventPane";
import {
	type CalendarJumpSearch,
	type CalendarWriteOutcome,
	calendarInstanceId,
	deviceTimeZone,
	draftFromEvent,
	emptyDraft,
	isoOnClock,
	moveRule,
	patchFromDrafts,
	rruleFromIcalData,
	type ScopedWrite,
	seriesOccurrenceOf,
	storedAnchorZone,
	textFromIcalData,
	textFromRrule,
	UNZONED_CALENDAR,
	useCalendarEvent,
	useCalendarJump,
	useCalendars,
	useCalendarWrites,
	useDraftClashes,
} from "@/hooks/calendar";
import { useCalendarData } from "@/hooks/useCalendarData";
import { formatEventWhen } from "@/lib/calendar-format";
import { calendarEventReportHref } from "@/lib/calendar-report";
import type { CalendarSearch } from "@/lib/calendar-route";
import { subscriptionReadOnlyNote } from "@/lib/calendar-subscription";
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

function SignInAgain() {
	const { Account } = useAuthProvider();
	return (
		<Account>
			{({ signOut }) => (
				<button
					type="button"
					onClick={() => signOut()}
					className="rounded-md border border-line px-2.5 py-1 text-sm font-medium text-fg outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-ring"
				>
					Sign in again
				</button>
			)}
		</Account>
	);
}

const absenceOf = (
	search: CalendarJumpSearch,
	loading: boolean,
): CalendarEventAbsence => {
	switch (search.kind) {
		case "Deleted":
		case "NoOccurrenceFound":
			return { kind: search.kind };
		case "SignedOut":
			return { kind: "SignedOut", signIn: <SignInAgain /> };
		case "Failed":
			return {
				kind: "Failed",
				reason: search.reason,
				reportHref: calendarEventReportHref(
					`opening an event failed: ${search.reason}`,
				),
			};
		case "Searching":
			return { kind: "Finding" };
		default:
			return { kind: loading ? "Finding" : "NotInView" };
	}
};

export function OpenCalendarEvent({
	calendarObjectId,
	recurrenceId,
}: OpenCalendarEventProps) {
	const { view, date, calendarIds } = useCalendarAddress();
	const { events, isLoading } = useCalendarData({ view, date, calendarIds });
	const { calendars, collections, timeZoneByCalendarId } = useCalendars();
	const { closeEvent } = useCalendarNavigation();
	const { updateEvent, deleteEvent, isWriting } = useCalendarWrites();

	const event = events.find(
		(candidate) =>
			candidate.id === calendarInstanceId(calendarObjectId, recurrenceId ?? ""),
	);
	const seriesOnly = recurrenceId === undefined && event === undefined;
	const occurrence = seriesOnly
		? seriesOccurrenceOf(events, calendarObjectId, new Date().toISOString())
		: undefined;
	const search = useCalendarJump(
		calendarObjectId,
		seriesOnly && !isLoading && occurrence === undefined,
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
	const clashes = useDraftClashes(
		draft ?? emptyDraft("", ""),
		calendarObjectId,
	);

	const stored = resource ? textFromIcalData(resource.icalData) : undefined;
	const rrule = resource ? rruleFromIcalData(resource.icalData) : "";
	const startTime = event && !event.allDay ? event.start.slice(11, 16) : "";
	const anchor = resource
		? storedAnchorZone(
				resource.icalData,
				timeZoneByCalendarId[event?.calendarId ?? ""] ?? UNZONED_CALENDAR,
			)
		: UNZONED_CALENDAR;
	const shownRule =
		event && !event.allDay
			? moveRule(
					rrule,
					isoOnClock(event.start, anchor === "" ? "UTC" : anchor).slice(0, 10),
					event.start.slice(0, 10),
				)
			: rrule;
	const repeat =
		rrule === "" ? "" : (textFromRrule(shownRule, startTime) ?? "Repeats");

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
	const writable =
		event !== undefined && resource !== undefined && !calendar?.readOnly;

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
		const patch = patchFromDrafts(editing.before, draft, {
			clock: deviceTimeZone(),
			anchor,
		});
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

	if (occurrence) {
		return (
			<Navigate
				to="/calendar/$view/$date/$calendarObjectId/$recurrenceId"
				params={{
					view,
					date,
					calendarObjectId,
					recurrenceId: occurrence.recurrenceId,
				}}
				search={true}
				hash={true}
				replace
			/>
		);
	}

	const jump = search.kind === "Found" ? search.jump : undefined;
	const hidden =
		jump !== undefined &&
		calendarIds.length > 0 &&
		!calendarIds.includes(jump.calendarId);
	if (jump && (jump.date !== date || hidden)) {
		const shown = hidden
			? (previous: CalendarSearch) => ({
					...previous,
					calendarId: [...calendarIds, jump.calendarId],
				})
			: true;
		return jump.recurrenceId === "" ? (
			<Navigate
				to="/calendar/$view/$date/$calendarObjectId"
				params={{ view, date: jump.date, calendarObjectId }}
				search={shown}
				hash={true}
				replace
			/>
		) : (
			<Navigate
				to="/calendar/$view/$date/$calendarObjectId/$recurrenceId"
				params={{
					view,
					date: jump.date,
					calendarObjectId,
					recurrenceId: jump.recurrenceId,
				}}
				search={shown}
				hash={true}
				replace
			/>
		);
	}

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
				clashes={clashes}
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
			readOnlyNote={
				calendar?.readOnly
					? subscriptionReadOnlyNote(
							collections.find(
								(collection) => collection.calendarId === calendar.id,
							)?.subscriptionUrl ?? "",
						)
					: ""
			}
			isOccurrence={recurrenceId !== undefined}
			absence={absenceOf(search, seriesOnly && isLoading)}
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
