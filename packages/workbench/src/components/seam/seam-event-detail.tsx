import {
	type CalendarEventData,
	calendarColorClasses,
	cn,
	RsvpBadge,
} from "@remit/ui";
import { Clock, Globe, MapPin, X } from "lucide-react";
import { calendarsById } from "../../fixtures/calendar.js";
import type { SeamThread } from "../../fixtures/calendar-mail.js";
import { AttendeeContextCard, AttendeeStrip } from "../attendee-context.js";
import { ThreadTranscript } from "./thread-view.js";

/**
 * An event opened, with the correspondence that produced it still attached and
 * still live. The thread is not a link to somewhere else — it is the second
 * half of the same object, which is why the reply that says the organiser is
 * running late is readable from the event rather than only from the inbox.
 */

export interface SeamEventDetailProps {
	event: CalendarEventData;
	whenText: string;
	thread?: SeamThread;
	activeAttendee: string;
	onActivateAttendee: (email: string) => void;
	onClose?: () => void;
	touch?: boolean;
	className?: string;
}

export function SeamEventDetail({
	event,
	whenText,
	thread,
	activeAttendee,
	onActivateAttendee,
	onClose,
	touch,
	className,
}: SeamEventDetailProps) {
	const calendar = calendarsById.get(event.calendarId);
	const hue = calendarColorClasses(calendar?.color ?? "cal-1");
	const active = event.attendees.find(
		(attendee) => attendee.email === activeAttendee,
	);

	return (
		<article className={cn("flex h-full flex-col bg-surface", className)}>
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<span className={cn("size-2.5 shrink-0 rounded-full", hue.solid)} />
				<span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
					{calendar?.name} · {calendar?.accountLabel}
				</span>
				{onClose && (
					<button
						type="button"
						aria-label="Close event"
						onClick={onClose}
						className={cn(
							"flex items-center justify-center rounded-md text-fg-subtle outline-none hover:bg-surface-sunken hover:text-fg focus-visible:ring-2 focus-visible:ring-ring",
							touch ? "size-11" : "size-7",
						)}
					>
						<X className="size-4" />
					</button>
				)}
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="border-b border-line px-row-inset py-3">
					<h1 className="text-xl font-semibold text-fg">{event.title}</h1>

					<p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg">
						<Clock className="size-4 shrink-0 text-fg-subtle" aria-hidden />
						{whenText}
						{event.attendees.length > 0 && <RsvpBadge rsvp={event.myRsvp} />}
					</p>
					{event.location !== "" && (
						<p className="mt-1 flex items-center gap-2 text-sm text-fg-muted">
							<MapPin className="size-4 shrink-0 text-fg-subtle" aria-hidden />
							{event.location}
						</p>
					)}
					{event.zoneCertainty === "ambiguous" && (
						<p className="mt-1 flex items-start gap-2 text-sm text-warning">
							<Globe className="mt-0.5 size-4 shrink-0" aria-hidden />
							The thread named a time and never a zone. Shown on your own clock
							until someone says otherwise.
						</p>
					)}

					{event.attendees.length > 0 && (
						<div className="relative mt-3">
							<p className="pb-1.5 text-2xs uppercase tracking-wider text-fg-subtle">
								{event.attendees.length} guests
							</p>
							<AttendeeStrip
								attendees={event.attendees}
								activeEmail={activeAttendee}
								onActivate={onActivateAttendee}
								touch={touch}
							/>
							{active && !touch && (
								<div className="absolute left-0 top-full z-20 mt-1">
									<AttendeeContextCard attendee={active} />
								</div>
							)}
						</div>
					)}
				</div>

				{thread ? (
					<>
						<h2 className="flex h-section-row items-center border-b border-line bg-surface-sunken px-row-inset text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
							The thread this came from
						</h2>
						<ThreadTranscript messages={thread.messages} />
					</>
				) : (
					<p className="px-row-inset py-3 text-sm text-fg-muted">
						Typed by hand. There is no mail behind this one.
					</p>
				)}
			</div>
		</article>
	);
}
