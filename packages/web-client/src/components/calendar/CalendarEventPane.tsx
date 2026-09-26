import type { CalendarDescriptor, CalendarEventData } from "@remit/ui";
import { EventDetail } from "@remit/ui";
import { AlertCircle, CalendarDays } from "lucide-react";
import type { ReactNode } from "react";
import { formatEventWhen } from "@/lib/calendar-format";

export type CalendarEventAbsence =
	| { kind: "NotInView" }
	| { kind: "Finding" }
	| { kind: "Deleted" }
	| { kind: "NoOccurrenceFound" }
	| { kind: "SignedOut"; signIn: ReactNode }
	| { kind: "Failed"; reason: string; reportHref: string };

const NOT_IN_VIEW: CalendarEventAbsence = { kind: "NotInView" };

const LINK =
	"rounded-md border border-line px-2.5 py-1 text-sm font-medium text-fg outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-ring";

function absenceText(absence: CalendarEventAbsence): {
	title: string;
	detail: string;
} {
	switch (absence.kind) {
		case "Finding":
			return {
				title: "Finding the event",
				detail: "Looking for the day it falls on.",
			};
		case "Deleted":
			return {
				title: "This event was deleted",
				detail: "None of your calendars holds it any more.",
			};
		case "NoOccurrenceFound":
			return {
				title: "No occurrence in its first year or the coming year",
				detail:
					"Its repeat rule, or the days taken out of it, leave it no day in either.",
			};
		case "SignedOut":
			return {
				title: "Your session has ended",
				detail: "Sign in again to open this event.",
			};
		case "Failed":
			return {
				title: "The event couldn't be looked up",
				detail: absence.reason,
			};
		case "NotInView":
			return {
				title: "That event isn't on this week",
				detail: "The address names an event the calendar doesn't have here.",
			};
	}
}

/**
 * The event the address has open.
 *
 * Presentational, like the workspace beside it: the route resolves the event
 * and turns closing, editing and deleting into things it does, so this renders
 * what it is handed and nothing else. Each control appears only when the route
 * gave it somewhere to go — a control that leads nowhere is worse than none.
 */
export interface CalendarEventPaneProps {
	/** Absent when the address names an event the calendar does not have. */
	event: CalendarEventData | undefined;
	calendar: CalendarDescriptor | undefined;
	/** Whether the address names one occurrence rather than the series. */
	isOccurrence: boolean;
	absence?: CalendarEventAbsence;
	/**
	 * A write that did not happen, stated where the reader is looking. Empty
	 * when the last one did.
	 */
	problem?: string;
	onEdit?: () => void;
	onDelete?: () => void;
	onClose: () => void;
}

export function CalendarEventPane({
	event,
	calendar,
	isOccurrence,
	absence = NOT_IN_VIEW,
	problem = "",
	onEdit,
	onDelete,
	onClose,
}: CalendarEventPaneProps) {
	if (!event || !calendar) {
		const { title, detail } = absenceText(absence);
		const loud = absence.kind === "Failed" || absence.kind === "SignedOut";
		return (
			<div
				role={loud ? "alert" : undefined}
				className="flex h-full flex-col items-center justify-center gap-2 bg-surface p-8 text-center"
			>
				<CalendarDays className="size-8 text-fg-subtle" aria-hidden="true" />
				<p className="text-sm font-medium text-fg">{title}</p>
				<p className="max-w-xs break-words text-sm text-fg-muted">{detail}</p>
				<div className="flex flex-wrap items-center justify-center gap-2">
					{absence.kind === "SignedOut" && absence.signIn}
					{absence.kind === "Failed" && (
						<a
							href={absence.reportHref}
							target="_blank"
							rel="noreferrer"
							className={LINK}
						>
							Report an issue
						</a>
					)}
					<button type="button" onClick={onClose} className={LINK}>
						Back to the calendar
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-surface">
			{isOccurrence && (
				<p className="shrink-0 border-b border-line bg-surface-sunken px-row-inset py-1.5 text-2xs uppercase tracking-wider text-fg-subtle">
					One occurrence of a repeating event
				</p>
			)}
			{problem !== "" && (
				<div
					role="alert"
					className="flex shrink-0 items-start gap-2 border-b border-danger/40 bg-danger-soft px-row-inset py-2 text-sm"
				>
					<AlertCircle
						className="mt-0.5 size-4 shrink-0 text-danger"
						aria-hidden="true"
					/>
					<p className="min-w-0 flex-1 break-words text-fg">{problem}</p>
				</div>
			)}
			<EventDetail
				event={event}
				calendar={calendar}
				whenText={formatEventWhen(event)}
				onEdit={onEdit}
				onDelete={onDelete}
				onClose={onClose}
				className="min-h-0 flex-1"
			/>
		</div>
	);
}
