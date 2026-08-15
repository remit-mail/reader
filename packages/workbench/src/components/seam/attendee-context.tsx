import { Avatar, type CalendarAttendee, cn, RsvpBadge } from "@remit/ui";
import { Mail } from "lucide-react";
import { contactMail } from "../../fixtures/calendar-mail.js";

/**
 * An attendee is a person you already have a correspondence with, so their name
 * on an invitation is a way into it. The list is the same guest list any client
 * shows; what is behind each row is the part only a mail client can offer.
 */

export function AttendeeContextCard({
	attendee,
	className,
}: {
	attendee: CalendarAttendee;
	className?: string;
}) {
	const recent = contactMail[attendee.email] ?? [];
	return (
		<div
			className={cn(
				"flex w-72 flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3 shadow-xl shadow-black/25",
				className,
			)}
		>
			<div className="flex items-center gap-2.5">
				<Avatar name={attendee.name} email={attendee.email} size="md" />
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-fg">
						{attendee.name}
					</span>
					<span className="block truncate text-2xs text-fg-subtle">
						{attendee.email}
					</span>
				</span>
				<RsvpBadge rsvp={attendee.rsvp} />
			</div>

			<p className="text-2xs uppercase tracking-wider text-fg-subtle">
				{recent.length === 0
					? "No mail with this address"
					: `Recent mail · ${recent.length}`}
			</p>

			{recent.map((item) => (
				<button
					key={item.id}
					type="button"
					className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-ring"
				>
					<Mail className="mt-0.5 size-3 shrink-0 text-fg-subtle" />
					<span className="min-w-0 flex-1">
						<span className="block truncate text-xs text-fg">
							{item.subject}
						</span>
						<span className="block truncate text-2xs text-fg-subtle">
							{item.snippet}
						</span>
					</span>
					<span className="shrink-0 text-2xs tabular-nums text-fg-subtle">
						{item.timeLabel}
					</span>
				</button>
			))}
		</div>
	);
}

export interface AttendeeStripProps {
	attendees: CalendarAttendee[];
	activeEmail: string;
	onActivate: (email: string) => void;
	touch?: boolean;
	className?: string;
}

/**
 * The guest list as a row of faces. Pointing at one on a desktop is enough to
 * open it; a thumb has to tap, and a tap on a phone opens a sheet rather than a
 * card that would sit under the finger.
 */
export function AttendeeStrip({
	attendees,
	activeEmail,
	onActivate,
	touch,
	className,
}: AttendeeStripProps) {
	return (
		<div className={cn("flex flex-wrap gap-1.5", className)}>
			{attendees.map((attendee) => (
				<button
					key={attendee.email}
					type="button"
					aria-pressed={attendee.email === activeEmail}
					onClick={() => onActivate(attendee.email)}
					onMouseEnter={touch ? undefined : () => onActivate(attendee.email)}
					onFocus={touch ? undefined : () => onActivate(attendee.email)}
					className={cn(
						"flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
						touch ? "min-h-11" : "min-h-7",
						attendee.email === activeEmail
							? "border-accent-2 bg-accent-2-soft text-fg"
							: "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg",
					)}
				>
					<Avatar name={attendee.name} email={attendee.email} size="sm" />
					<span className="truncate">{attendee.name}</span>
					{attendee.role === "organizer" && (
						<span className="text-2xs text-fg-subtle">· organiser</span>
					)}
				</button>
			))}
		</div>
	);
}
