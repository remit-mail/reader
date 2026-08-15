import { Check, Clock, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Avatar } from "./avatar.js";
import type { CalendarAttendee, RsvpState } from "./calendar-types.js";

const rsvpLabels: Record<RsvpState, string> = {
	accepted: "Coming",
	tentative: "Maybe",
	declined: "Not coming",
	noReply: "No reply",
};

const rsvpTone: Record<RsvpState, string> = {
	accepted: "text-positive",
	tentative: "text-warning",
	declined: "text-danger",
	noReply: "text-fg-subtle",
};

const rsvpIcons: Record<RsvpState, typeof Check> = {
	accepted: Check,
	tentative: Clock,
	declined: X,
	noReply: Minus,
};

export interface RsvpBadgeProps {
	rsvp: RsvpState;
	className?: string;
}

/** The reply, in words and a mark — never colour alone. */
export function RsvpBadge({ rsvp, className }: RsvpBadgeProps) {
	const Icon = rsvpIcons[rsvp];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 text-2xs font-medium",
				rsvpTone[rsvp],
				className,
			)}
		>
			<Icon className="size-3" />
			{rsvpLabels[rsvp]}
		</span>
	);
}

export interface AttendeeRowProps {
	attendee: CalendarAttendee;
	/** Marks the row whose context is open. */
	active?: boolean;
	/** Hover, focus or tap on the row. Absent leaves it inert, as today. */
	onActivate?: (email: string) => void;
	/** A thumb has to tap; a pointer only has to arrive. */
	touch?: boolean;
	className?: string;
}

export function AttendeeRow({
	attendee,
	active = false,
	onActivate,
	touch = false,
	className,
}: AttendeeRowProps) {
	const face = (
		<>
			<Avatar name={attendee.name} email={attendee.email} size="sm" />
			<span className="min-w-0 flex-1 text-left">
				<span className="block truncate text-sm text-fg">{attendee.name}</span>
				{attendee.role === "organizer" && (
					<span className="block text-2xs text-fg-subtle">Organiser</span>
				)}
			</span>
			<RsvpBadge rsvp={attendee.rsvp} />
		</>
	);

	const shape = cn(
		"flex w-full items-center gap-2.5",
		touch ? "min-h-11" : "min-h-9",
		className,
	);

	if (!onActivate) return <div className={shape}>{face}</div>;

	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={() => onActivate(attendee.email)}
			onMouseEnter={touch ? undefined : () => onActivate(attendee.email)}
			onFocus={touch ? undefined : () => onActivate(attendee.email)}
			className={cn(
				shape,
				"rounded-md px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
				active ? "bg-accent-2-soft" : "hover:bg-surface-sunken",
			)}
		>
			{face}
		</button>
	);
}

export interface AttendeeListProps {
	attendees: CalendarAttendee[];
	/** The guest whose context is open. Empty for none. */
	activeEmail?: string;
	/** Hover, focus or tap on a row. Absent leaves the list inert, as today. */
	onActivate?: (email: string) => void;
	/** Rendered anchored to the active row. The kit knows nothing about mail. */
	renderContext?: (attendee: CalendarAttendee) => ReactNode;
	touch?: boolean;
	className?: string;
}

/**
 * The full guest list with a one-line tally above it. A row is a control only
 * where the surface has something to say about the person behind it; pointing
 * away closes what pointing at them opened.
 */
export function AttendeeList({
	attendees,
	activeEmail = "",
	onActivate,
	renderContext,
	touch = false,
	className,
}: AttendeeListProps) {
	if (attendees.length === 0) return null;
	/** Leaving the guests behind is the answer to "which of them was I reading". */
	const closeOnLeave = onActivate && !touch ? () => onActivate("") : undefined;
	const tally = (["accepted", "tentative", "declined", "noReply"] as const)
		.map((state) => ({
			state,
			count: attendees.filter((a) => a.rsvp === state).length,
		}))
		.filter((entry) => entry.count > 0)
		.map((entry) => `${entry.count} ${rsvpLabels[entry.state].toLowerCase()}`)
		.join(" · ");

	return (
		<div
			className={cn("flex flex-col", className)}
			onPointerLeave={closeOnLeave}
		>
			<p className="pb-1 text-2xs uppercase tracking-wider text-fg-subtle">
				{`${attendees.length} guests · ${tally}`}
			</p>
			{attendees.map((attendee) => {
				const active = attendee.email === activeEmail;
				return (
					<div key={attendee.email} className="relative">
						<AttendeeRow
							attendee={attendee}
							active={active}
							onActivate={onActivate}
							touch={touch}
						/>
						{active && renderContext && (
							<div className="absolute left-0 top-full z-20 pt-1">
								{renderContext(attendee)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
