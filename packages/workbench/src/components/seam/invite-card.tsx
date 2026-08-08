import {
	Button,
	type CalendarAttendee,
	type CalendarEventData,
	calendarColorClasses,
	cn,
	RsvpBadge,
	type RsvpState,
} from "@remit/ui";
import { Check, Clock, MapPin, TriangleAlert, X } from "lucide-react";
import { calendarsById } from "../../fixtures/calendar.js";
import type { InviteData } from "../../fixtures/calendar-seam.js";
import { AttendeeStrip } from "./attendee-context.js";
import { ParseBadge } from "./parse-provenance.js";

/**
 * The invitation, rendered as the thing it is instead of an attachment nobody
 * opens. Every mail client puts Accept and Decline on an invite; none of them
 * tells you what saying yes would cost, because none of them owns the calendar
 * the answer lands in. The clash is stated above the buttons — before the
 * answer, not after it — and it is stated across accounts, which is where the
 * collisions that actually hurt live.
 */

export interface InviteCardProps {
	invite: InviteData;
	whenText: string;
	rsvp: RsvpState;
	onRsvp: (next: RsvpState) => void;
	/** Everything already booked over the proposed span. */
	conflicts: CalendarEventData[];
	conflictLabel: (event: CalendarEventData) => string;
	activeAttendee: string;
	onActivateAttendee: (email: string) => void;
	onProposeOther: () => void;
	touch?: boolean;
	className?: string;
}

const answers: { value: RsvpState; label: string }[] = [
	{ value: "accepted", label: "Accept" },
	{ value: "tentative", label: "Maybe" },
	{ value: "declined", label: "Decline" },
];

export function InviteCard({
	invite,
	whenText,
	rsvp,
	onRsvp,
	conflicts,
	conflictLabel,
	activeAttendee,
	onActivateAttendee,
	onProposeOther,
	touch,
	className,
}: InviteCardProps) {
	const calendar = calendarsById.get(invite.proposed.calendarId);
	const hue = calendarColorClasses(calendar?.color ?? "cal-1");
	const answered = rsvp !== "noReply";
	const attendees: CalendarAttendee[] = invite.proposed.attendees;

	return (
		<section
			className={cn(
				"flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-3",
				className,
			)}
		>
			<div className="flex items-center gap-2">
				<span className={cn("size-2.5 shrink-0 rounded-full", hue.solid)} />
				<span className="min-w-0 flex-1 truncate text-2xs uppercase tracking-wider text-fg-subtle">
					Invitation from {invite.organizerName} · {calendar?.name}
				</span>
				<ParseBadge method={invite.method} />
			</div>

			<div>
				<h3 className="text-md font-semibold text-fg">
					{invite.proposed.title}
				</h3>
				<p className="mt-1 flex items-center gap-2 text-sm text-fg">
					<Clock className="size-4 shrink-0 text-fg-subtle" aria-hidden />
					{whenText}
				</p>
				{invite.proposed.location !== "" && (
					<p className="mt-1 flex items-center gap-2 text-sm text-fg-muted">
						<MapPin className="size-4 shrink-0 text-fg-subtle" aria-hidden />
						{invite.proposed.location}
					</p>
				)}
			</div>

			{conflicts.length > 0 ? (
				<div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft p-2">
					<TriangleAlert
						className="mt-0.5 size-4 shrink-0 text-danger"
						aria-hidden
					/>
					<div className="min-w-0 flex-1">
						<p className="text-xs font-semibold text-danger">
							{conflicts.length === 1
								? "This clashes with something you have already agreed to."
								: `This clashes with ${conflicts.length} things you have already agreed to.`}
						</p>
						<ul className="mt-1 flex flex-col gap-0.5">
							{conflicts.map((clash) => (
								<li key={clash.id} className="text-xs text-fg">
									{conflictLabel(clash)}
								</li>
							))}
						</ul>
					</div>
				</div>
			) : (
				<p className="flex items-center gap-2 rounded-md border border-line bg-surface-sunken p-2 text-xs text-fg-muted">
					<Check className="size-3.5 shrink-0 text-positive" aria-hidden />
					Nothing else is booked over it.
				</p>
			)}

			<div>
				<p className="pb-1.5 text-2xs uppercase tracking-wider text-fg-subtle">
					{attendees.length} guests
				</p>
				<AttendeeStrip
					attendees={attendees}
					activeEmail={activeAttendee}
					onActivate={onActivateAttendee}
					touch={touch}
				/>
			</div>

			{answered ? (
				<div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
					<span className="flex items-center gap-1.5 text-sm text-fg">
						You answered
						<RsvpBadge rsvp={rsvp} />
					</span>
					<Button
						variant="ghost"
						size={touch ? "md" : "sm"}
						onClick={() => onRsvp("noReply")}
						className={touch ? "min-h-11" : ""}
					>
						Change
					</Button>
					{rsvp === "declined" && (
						<Button
							variant="secondary"
							size={touch ? "md" : "sm"}
							onClick={onProposeOther}
							className={touch ? "min-h-11" : ""}
						>
							Offer other times
						</Button>
					)}
				</div>
			) : (
				<div
					className={cn(
						"flex gap-2 border-t border-line pt-3",
						touch && "flex-wrap",
					)}
				>
					{answers.map((answer) => (
						<Button
							key={answer.value}
							variant={answer.value === "accepted" ? "primary" : "secondary"}
							size={touch ? "md" : "sm"}
							onClick={() => onRsvp(answer.value)}
							className={cn(touch && "min-h-11 flex-1")}
							icon={
								answer.value === "declined" ? (
									<X className="size-3.5" />
								) : answer.value === "accepted" ? (
									<Check className="size-3.5" />
								) : undefined
							}
						>
							{answer.label}
						</Button>
					))}
					<Button
						variant="ghost"
						size={touch ? "md" : "sm"}
						onClick={onProposeOther}
						className={cn(touch ? "min-h-11 w-full" : "ml-auto")}
					>
						Offer other times
					</Button>
				</div>
			)}
		</section>
	);
}
