import {
	Calendar,
	Check,
	Clock,
	History,
	MapPin,
	Trash2,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { calendarColorClasses } from "../lib/calendar-color.js";
import { cn } from "../lib/cn.js";
import { RsvpBadge } from "./attendee-row.js";
import { Button } from "./button.js";
import { CalendarClashStrip } from "./calendar-clash-strip.js";
import { CalendarParseBadge } from "./calendar-parse-badge.js";
import type {
	CalendarClash,
	CalendarColorId,
	CalendarInvite,
	RsvpState,
} from "./calendar-types.js";

/**
 * The invitation, rendered as the thing it is instead of an attachment nobody
 * opens. What saying yes would cost is stated above the button — before the
 * answer, not after it — and it is stated across accounts, which is where the
 * collisions that actually hurt live.
 *
 * The button reads "Add to calendar" because that is all it does. This plan
 * sends no iMIP reply, so the organiser learns nothing from it, and the card
 * says so where the press happens rather than in a settings page.
 */

export interface CalendarInviteCardProps {
	invite: CalendarInvite;
	/** Already formatted by the caller. */
	whenText: string;
	/** The calendar the event would land on. */
	calendarName: string;
	color: CalendarColorId;
	/** Everything already booked over the proposed span. */
	clashes: CalendarClash[];
	rsvp: RsvpState;
	onAdd: () => void;
	onTentative: () => void;
	onDecline: () => void;
	onReopen: () => void;
	onOfferOtherTimes: () => void;
	/** Wired only for a cancellation the reader has not acted on. */
	onRemove?: () => void;
	/** Wired only when a later message carries a higher SEQUENCE. */
	onOpenNewer?: () => void;
	/**
	 * Replaces the guest tally — a host with a richer guest surface of its own
	 * passes it here rather than the card growing a second one.
	 */
	guests?: ReactNode;
	touch?: boolean;
	className?: string;
}

const tallyOrder: RsvpState[] = [
	"accepted",
	"tentative",
	"declined",
	"noReply",
];

const tallyWord: Record<RsvpState, string> = {
	accepted: "coming",
	tentative: "maybe",
	declined: "not coming",
	noReply: "no reply",
};

export function CalendarInviteCard({
	invite,
	whenText,
	calendarName,
	color,
	clashes,
	rsvp,
	onAdd,
	onTentative,
	onDecline,
	onReopen,
	onOfferOtherTimes,
	onRemove,
	onOpenNewer,
	guests,
	touch,
	className,
}: CalendarInviteCardProps) {
	const hue = calendarColorClasses(color);
	const stale = invite.state === "superseded" || invite.state === "cancelled";
	const attendees = invite.proposed.attendees;
	const tally = tallyOrder
		.map((state) => ({
			state,
			count: attendees.filter((person) => person.rsvp === state).length,
		}))
		.filter((entry) => entry.count > 0)
		.map((entry) => `${entry.count} ${tallyWord[entry.state]}`)
		.join(" · ");

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
					Invitation from {invite.organizerName} · {calendarName}
				</span>
				<CalendarParseBadge method={invite.method} />
			</div>

			<div className={cn(stale && "opacity-60")}>
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

			{invite.state === "superseded" && (
				<div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-2">
					<History
						className="mt-0.5 size-4 shrink-0 text-warning"
						aria-hidden
					/>
					<div className="min-w-0 flex-1">
						<p className="text-xs font-semibold text-warning">
							{invite.organizerName} has sent a newer version of this.
						</p>
						<p className="mt-1 text-xs text-fg">
							This one is revision {invite.sequence} and is out of date. Answer
							the newer one instead.
						</p>
						{onOpenNewer && (
							<Button
								variant="secondary"
								size={touch ? "md" : "sm"}
								onClick={onOpenNewer}
								className={cn("mt-2", touch && "min-h-11")}
							>
								Open the newer invitation
							</Button>
						)}
					</div>
				</div>
			)}

			{invite.state === "cancelled" && (
				<div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft p-2">
					<X className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
					<div className="min-w-0 flex-1">
						<p className="text-xs font-semibold text-danger">
							{invite.organizerName} cancelled this.
						</p>
						<p className="mt-1 text-xs text-fg">
							It is still on your calendar. Nothing comes off it until you say
							so.
						</p>
						{onRemove && (
							<div className={cn("mt-2 flex gap-2", touch && "flex-wrap")}>
								<Button
									variant="primary"
									size={touch ? "md" : "sm"}
									icon={<Trash2 className="size-3.5" />}
									onClick={onRemove}
									className={cn(touch && "min-h-11 flex-1")}
								>
									Remove from calendar
								</Button>
								<Button
									variant="secondary"
									size={touch ? "md" : "sm"}
									onClick={onReopen}
									className={cn(touch && "min-h-11 flex-1")}
								>
									Keep it
								</Button>
							</div>
						)}
					</div>
				</div>
			)}

			{!stale && <CalendarClashStrip clashes={clashes} />}

			{guests ?? (
				<p className="text-2xs uppercase tracking-wider text-fg-subtle">
					{attendees.length} guests{tally === "" ? "" : ` · ${tally}`}
				</p>
			)}

			{!stale &&
				(rsvp === "noReply" ? (
					<div className="flex flex-col gap-2 border-t border-line pt-3">
						<div className={cn("flex gap-2", touch && "flex-wrap")}>
							<Button
								variant="primary"
								size={touch ? "md" : "sm"}
								icon={<Calendar className="size-3.5" />}
								onClick={onAdd}
								className={cn(touch && "min-h-11 flex-1")}
							>
								Add to calendar
							</Button>
							<Button
								variant="secondary"
								size={touch ? "md" : "sm"}
								onClick={onTentative}
								className={cn(touch && "min-h-11 flex-1")}
							>
								Maybe
							</Button>
							<Button
								variant="secondary"
								size={touch ? "md" : "sm"}
								icon={<X className="size-3.5" />}
								onClick={onDecline}
								className={cn(touch && "min-h-11 flex-1")}
							>
								Decline
							</Button>
						</div>
						<Button
							variant="ghost"
							size={touch ? "md" : "sm"}
							onClick={onOfferOtherTimes}
							className={cn("self-start", touch && "min-h-11 w-full")}
						>
							Offer other times
						</Button>
						<p className="text-2xs text-fg-subtle">
							{invite.organizerName} is not notified. Reader writes this to your
							calendar and sends no reply — tell them in the thread.
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-2 border-t border-line pt-3">
						<div className="flex flex-wrap items-center gap-3">
							<span className="flex items-center gap-1.5 text-sm text-fg">
								{rsvp === "declined" ? "You declined" : "On your calendar"}
								<RsvpBadge rsvp={rsvp} />
							</span>
							<Button
								variant="ghost"
								size={touch ? "md" : "sm"}
								onClick={onReopen}
								className={touch ? "min-h-11" : ""}
							>
								Change
							</Button>
							{rsvp === "declined" && (
								<Button
									variant="secondary"
									size={touch ? "md" : "sm"}
									onClick={onOfferOtherTimes}
									className={touch ? "min-h-11" : ""}
								>
									Offer other times
								</Button>
							)}
						</div>
						<p className="flex items-start gap-1.5 text-2xs text-fg-subtle">
							<Check className="mt-0.5 size-3 shrink-0" aria-hidden />
							{invite.organizerName} was not notified.
						</p>
					</div>
				))}
		</section>
	);
}
