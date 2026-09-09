import { Check, Clock, Minus, X } from "lucide-react";
import { Fragment, type ReactNode, useId } from "react";
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
	/**
	 * Called with the guest to open and with "" to close, so a row that is
	 * already open closes on the next activation. Absent leaves the row inert,
	 * as today.
	 */
	onActivate?: (email: string) => void;
	/** The disclosure this row opens, so the button can name what it controls. */
	contextId?: string;
	/** A thumb needs a bigger row than a pointer does. */
	touch?: boolean;
	className?: string;
}

export function AttendeeRow({
	attendee,
	active = false,
	onActivate,
	contextId,
	touch = false,
	className,
}: AttendeeRowProps) {
	const face = (
		<>
			<Avatar name={attendee.name} email={attendee.email} size="sm" />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm text-fg">{attendee.name}</span>
				{attendee.role === "organizer" && (
					<span className="block text-2xs text-fg-subtle">Organiser</span>
				)}
			</span>
			<RsvpBadge rsvp={attendee.rsvp} />
		</>
	);

	if (!onActivate)
		return (
			<div className={cn("flex min-h-9 items-center gap-2.5", className)}>
				{face}
			</div>
		);

	return (
		<button
			type="button"
			aria-expanded={active}
			aria-controls={active && contextId !== undefined ? contextId : undefined}
			onClick={() => onActivate(active ? "" : attendee.email)}
			onKeyDown={(event) => {
				if (event.key === "Escape") onActivate("");
			}}
			onBlur={(event) => {
				if (!active) return;
				// Only focus landing on something else is focus leaving the guest.
				// Clicking the text inside the disclosure focuses nothing at all, and
				// what the row opened is rendered beside it, so neither closes it.
				if (event.relatedTarget === null) return;
				if (event.currentTarget.parentElement?.contains(event.relatedTarget))
					return;
				onActivate("");
			}}
			className={cn(
				"flex w-full items-center gap-2.5 rounded-md px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
				touch ? "min-h-11" : "min-h-9",
				active ? "bg-accent-2-soft" : "hover:bg-surface-sunken",
				className,
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
	/** Called with a guest to open and with "" to close. */
	onActivate?: (email: string) => void;
	/** Rendered under the open row. The kit knows nothing about mail. */
	renderContext?: (attendee: CalendarAttendee) => ReactNode;
	touch?: boolean;
	className?: string;
}

/**
 * The full guest list with a one-line tally above it. A row is a control only
 * where the surface has something to say about the person behind it, and what
 * it opens is a disclosure under the row rather than a card over the pane: the
 * same gesture closes it, so do Escape and taking focus elsewhere.
 */
export function AttendeeList({
	attendees,
	activeEmail = "",
	onActivate,
	renderContext,
	touch = false,
	className,
}: AttendeeListProps) {
	const listId = useId();
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
			{attendees.map((attendee, index) => {
				const active = attendee.email === activeEmail;
				const contextId = `${listId}-guest-${index}`;
				const row = (
					<AttendeeRow
						attendee={attendee}
						active={active}
						onActivate={onActivate}
						contextId={renderContext ? contextId : undefined}
						touch={touch}
					/>
				);
				if (!onActivate) return <Fragment key={attendee.email}>{row}</Fragment>;
				return (
					<div key={attendee.email}>
						{row}
						{active && renderContext && (
							<div id={contextId} className="py-1">
								{renderContext(attendee)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
