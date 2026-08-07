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

const rsvpIcons: Record<RsvpState, ReactNode> = {
	accepted: <Check className="size-3" />,
	tentative: <Clock className="size-3" />,
	declined: <X className="size-3" />,
	noReply: <Minus className="size-3" />,
};

export interface RsvpBadgeProps {
	rsvp: RsvpState;
	className?: string;
}

/** The reply, in words and a mark — never colour alone. */
export function RsvpBadge({ rsvp, className }: RsvpBadgeProps) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 text-2xs font-medium",
				rsvpTone[rsvp],
				className,
			)}
		>
			{rsvpIcons[rsvp]}
			{rsvpLabels[rsvp]}
		</span>
	);
}

export interface AttendeeRowProps {
	attendee: CalendarAttendee;
	className?: string;
}

export function AttendeeRow({ attendee, className }: AttendeeRowProps) {
	return (
		<div className={cn("flex min-h-9 items-center gap-2.5", className)}>
			<Avatar name={attendee.name} email={attendee.email} size="sm" />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm text-fg">{attendee.name}</span>
				{attendee.role === "organizer" && (
					<span className="block text-2xs text-fg-subtle">Organiser</span>
				)}
			</span>
			<RsvpBadge rsvp={attendee.rsvp} />
		</div>
	);
}

export interface AttendeeListProps {
	attendees: CalendarAttendee[];
	className?: string;
}

/** The full guest list with a one-line tally above it. */
export function AttendeeList({ attendees, className }: AttendeeListProps) {
	if (attendees.length === 0) return null;
	const tally = (["accepted", "tentative", "declined", "noReply"] as const)
		.map((state) => ({
			state,
			count: attendees.filter((a) => a.rsvp === state).length,
		}))
		.filter((entry) => entry.count > 0)
		.map((entry) => `${entry.count} ${rsvpLabels[entry.state].toLowerCase()}`)
		.join(" · ");

	return (
		<div className={cn("flex flex-col", className)}>
			<p className="pb-1 text-2xs uppercase tracking-wider text-fg-subtle">
				{`${attendees.length} guests · ${tally}`}
			</p>
			{attendees.map((attendee) => (
				<AttendeeRow key={attendee.email} attendee={attendee} />
			))}
		</div>
	);
}
