import {
	Clock,
	Globe,
	Mail,
	MapPin,
	Pencil,
	Repeat,
	Trash2,
	X,
} from "lucide-react";
import { calendarColorClasses } from "../lib/calendar-color.js";
import { cn } from "../lib/cn.js";
import { AttendeeList, RsvpBadge } from "./attendee-row.js";
import { Button } from "./button.js";
import type {
	CalendarDescriptor,
	CalendarEventData,
} from "./calendar-types.js";

export interface EventDetailProps {
	event: CalendarEventData;
	calendar: CalendarDescriptor;
	/** Already formatted by the caller — the component owns no clock. */
	whenText: string;
	onEdit: () => void;
	onDelete: () => void;
	/** Absent when the event was never born from a mail. */
	onOpenThread?: () => void;
	/** Puts the pane back to whatever it shows with nothing selected. */
	onClose?: () => void;
	className?: string;
}

function Line({
	icon,
	children,
}: {
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-start gap-2.5 py-1">
			<span className="mt-0.5 shrink-0 text-fg-subtle">{icon}</span>
			<div className="min-w-0 flex-1 text-sm text-fg">{children}</div>
		</div>
	);
}

/**
 * One event, opened. The link back to the mail it came from is part of the
 * event rather than a footnote: an event with a thread behind it is never a
 * dead end, and the way back is one click from the detail you are reading.
 */
export function EventDetail({
	event,
	calendar,
	whenText,
	onEdit,
	onDelete,
	onOpenThread,
	onClose,
	className,
}: EventDetailProps) {
	const hue = calendarColorClasses(calendar.color);

	return (
		<article
			className={cn("flex h-full w-full flex-col bg-surface", className)}
		>
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<span className={cn("size-2.5 shrink-0 rounded-full", hue.solid)} />
				<span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
					{calendar.name} · {calendar.accountLabel}
				</span>
				<Button
					variant="ghost"
					size="sm"
					icon={<Pencil className="size-3.5" />}
					onClick={onEdit}
				>
					Edit
				</Button>
				<Button
					variant="ghost"
					size="sm"
					icon={<Trash2 className="size-3.5" />}
					onClick={onDelete}
					className="text-danger"
				>
					Delete
				</Button>
				{onClose && (
					<button
						type="button"
						aria-label="Close event"
						onClick={onClose}
						className="flex size-7 items-center justify-center rounded-md text-fg-subtle outline-none hover:bg-surface-sunken hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
					>
						<X className="size-4" />
					</button>
				)}
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-row-inset py-3">
				<h1 className="text-xl font-semibold text-fg">{event.title}</h1>

				<div className="mt-3 flex flex-col border-b border-line pb-3">
					<Line icon={<Clock className="size-4" />}>
						<span className="flex flex-wrap items-center gap-2">
							{whenText}
							{event.attendees.length > 0 && <RsvpBadge rsvp={event.myRsvp} />}
						</span>
					</Line>
					{event.zoneCertainty === "ambiguous" ? (
						<Line icon={<Globe className="size-4 text-warning" />}>
							<span className="text-warning">
								The mail said a time but never a zone. Shown in your own;
								confirm before you travel for it.
							</span>
						</Line>
					) : (
						event.timeZone !== "" && (
							<Line icon={<Globe className="size-4" />}>{event.timeZone}</Line>
						)
					)}
					{event.recurrenceRule !== "" && (
						<Line icon={<Repeat className="size-4" />}>
							{event.recurrenceRule}
						</Line>
					)}
					{event.location !== "" && (
						<Line icon={<MapPin className="size-4" />}>{event.location}</Line>
					)}
				</div>

				{event.threadId !== "" && onOpenThread && (
					<button
						type="button"
						onClick={onOpenThread}
						className="mt-3 flex w-full items-center gap-2.5 rounded-md border border-line bg-surface-sunken px-3 py-2 text-left outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Mail className="size-4 shrink-0 text-accent-2" />
						<span className="min-w-0 flex-1">
							<span className="block text-2xs uppercase tracking-wider text-fg-subtle">
								From this thread
							</span>
							<span className="block truncate text-sm text-fg">
								{event.threadSubject}
							</span>
						</span>
					</button>
				)}

				{event.attendees.length > 0 && (
					<AttendeeList attendees={event.attendees} className="mt-3" />
				)}

				{event.notes !== "" && (
					<p className="mt-3 whitespace-pre-wrap text-sm text-fg-muted">
						{event.notes}
					</p>
				)}
			</div>
		</article>
	);
}
