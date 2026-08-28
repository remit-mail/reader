import { CalendarDays } from "lucide-react";
import { cn } from "../lib/cn.js";
import { CalendarEventChip } from "./calendar-event-chip.js";
import { CalendarInviteCard } from "./calendar-invite-card.js";
import { CalendarSlotOffers } from "./calendar-slot-offers.js";
import { CalendarSuggestionDeck } from "./calendar-suggestion-deck.js";
import type {
	CalendarClash,
	CalendarColorId,
	CalendarEventData,
	CalendarInvite,
	CalendarProposal,
	CalendarSlotPick,
	EventSuggestion,
	RsvpState,
} from "./calendar-types.js";
import { EventSuggestionCard } from "./event-suggestion-card.js";
import { IntelligenceSection } from "./intelligence-section.js";

/**
 * The calendar half of the intelligence panel. It is the day the open message
 * argues about, and nothing more: what the message would cost, what is already
 * booked over it, what could be offered back. There is no grid here and nothing
 * to drag — those live at `/calendar`, and this tab exists because the decision
 * about time is being made in the mail, not there.
 *
 * The panel has a thread or it does not render at all, so this tab is a clash
 * check before an answer rather than a queue of every pending invitation.
 */

/** The invitation the open message carries, with the day already checked. */
export interface CalendarInviteIntel {
	invite: CalendarInvite;
	/** Already formatted by the caller. */
	whenText: string;
	/** The calendar the event would land on. */
	calendarName: string;
	color: CalendarColorId;
	clashes: CalendarClash[];
	rsvp: RsvpState;
}

/** One reading off this thread that is not the invitation. */
export interface CalendarSuggestionIntel {
	suggestion: EventSuggestion;
	whenText: string;
}

/** An event already on the day, drawn as the chip every calendar surface uses. */
export interface CalendarDayEntry {
	event: CalendarEventData;
	/** Already formatted; empty for an all-day entry. */
	timeText: string;
	color: CalendarColorId;
}

/** Times this thread named in prose, checked against the day it named. */
export interface CalendarProseIntel {
	/** The day in words — "Thursday 11 June". */
	dayLabel: string;
	proposals: CalendarProposal[];
	/** What could be offered back, cut off that day's free gaps. */
	slots: CalendarSlotPick[];
	/** Start clocks already ticked into the reply. */
	picked: readonly string[];
}

export interface IntelligenceCalendarData {
	invite?: CalendarInviteIntel;
	prose?: CalendarProseIntel;
	/** Newest first. The deck shows the first one and counts the rest. */
	suggestions: CalendarSuggestionIntel[];
	/** What is already booked on the day under discussion. */
	day: CalendarDayEntry[];
	/** The day those entries sit on, in words. */
	dayLabel: string;
}

export interface IntelligenceCalendarActions {
	onAddInvite: () => void;
	onTentativeInvite: () => void;
	onDeclineInvite: () => void;
	onReopenInvite: () => void;
	onOfferOtherTimes: () => void;
	onRemoveInvite: () => void;
	onOpenNewerInvite: () => void;
	onToggleSlot: (slot: CalendarSlotPick) => void;
	onAddSuggestion: (suggestionId: string, timeZone: string) => void;
	onReviewSuggestion: (suggestionId: string, timeZone: string) => void;
	onDismissSuggestion: (suggestionId: string) => void;
	onOpenThread: (threadId: string) => void;
	onSelectEvent: (eventId: string) => void;
}

export interface IntelligenceCalendarProps {
	data: IntelligenceCalendarData;
	actions: IntelligenceCalendarActions;
	/** The event the day list is showing as selected; empty when none is. */
	selectedEventId?: string;
	touch?: boolean;
	className?: string;
}

export function IntelligenceCalendar({
	data,
	actions,
	selectedEventId = "",
	touch,
	className,
}: IntelligenceCalendarProps) {
	const { invite, prose, suggestions, day, dayLabel } = data;
	const top = suggestions[0];
	const picked = new Set(prose?.picked ?? []);
	const nothingToSay =
		invite === undefined &&
		prose === undefined &&
		suggestions.length === 0 &&
		day.length === 0;

	if (nothingToSay)
		return (
			<div
				className={cn(
					"flex flex-1 flex-col items-center justify-center gap-2 px-row-inset py-10 text-center",
					className,
				)}
			>
				<CalendarDays className="size-6 text-fg-subtle" aria-hidden />
				<p className="text-sm text-fg-muted">
					Nothing in this message is about a time.
				</p>
				<p className="text-2xs text-fg-subtle">
					An invitation, a booking or a thread proposing hours would show up
					here, with the day it lands on.
				</p>
			</div>
		);

	return (
		<div className={cn("flex flex-col", className)}>
			{invite && (
				<IntelligenceSection label="Invitation">
					<CalendarInviteCard
						invite={invite.invite}
						whenText={invite.whenText}
						calendarName={invite.calendarName}
						color={invite.color}
						clashes={invite.clashes}
						rsvp={invite.rsvp}
						onAdd={actions.onAddInvite}
						onTentative={actions.onTentativeInvite}
						onDecline={actions.onDeclineInvite}
						onReopen={actions.onReopenInvite}
						onOfferOtherTimes={actions.onOfferOtherTimes}
						onRemove={actions.onRemoveInvite}
						onOpenNewer={actions.onOpenNewerInvite}
						touch={touch}
					/>
				</IntelligenceSection>
			)}

			{prose && (
				<IntelligenceSection label={`Times named · ${prose.dayLabel}`}>
					<ul className="flex flex-col gap-1">
						{prose.proposals.map((proposal) => (
							<li
								key={proposal.id}
								className="flex items-baseline gap-2 text-xs"
							>
								<span className="w-24 shrink-0 truncate tabular-nums text-fg">
									{proposal.phrase}
								</span>
								{proposal.clashTitle === "" ? (
									<span className="min-w-0 flex-1 truncate text-positive">
										Nothing booked
									</span>
								) : (
									<span className="min-w-0 flex-1 truncate text-danger">
										{proposal.clashTitle} is already there
									</span>
								)}
							</li>
						))}
					</ul>
					<p className="mt-3 pb-1.5 text-2xs uppercase tracking-wider text-fg-subtle">
						Free, half an hour each
					</p>
					<CalendarSlotOffers
						slots={prose.slots}
						picked={picked}
						onToggle={actions.onToggleSlot}
						touch={touch}
						scroll
					/>
					<p className="mt-1.5 text-2xs text-fg-subtle">
						Picked slots go into the reply as plain text. Nothing is booked.
					</p>
				</IntelligenceSection>
			)}

			{suggestions.length > 0 && (
				<IntelligenceSection label="Read out of this thread">
					<CalendarSuggestionDeck
						hasCard={top !== undefined}
						remaining={suggestions.length}
						blocked={false}
						blockedReason=""
						onConfirm={() => {
							if (top) actions.onAddSuggestion(top.suggestion.id, "");
						}}
						onReject={() => {
							if (top) actions.onDismissSuggestion(top.suggestion.id);
						}}
					>
						{top && (
							<EventSuggestionCard
								suggestion={top.suggestion}
								whenText={top.whenText}
								addLabel="Add to calendar"
								onAdd={(timeZone) =>
									actions.onAddSuggestion(top.suggestion.id, timeZone)
								}
								onReview={(timeZone) =>
									actions.onReviewSuggestion(top.suggestion.id, timeZone)
								}
								onDismiss={() => actions.onDismissSuggestion(top.suggestion.id)}
								onOpenThread={() =>
									actions.onOpenThread(top.suggestion.threadId)
								}
								touch={touch}
							/>
						)}
					</CalendarSuggestionDeck>
					<p className="mt-2 text-2xs text-fg-subtle">
						None of this is on your calendar, and none of it will be until you
						say so.
					</p>
				</IntelligenceSection>
			)}

			{day.length > 0 && (
				<IntelligenceSection label={dayLabel} className="border-b-0">
					<ul className="flex flex-col gap-1">
						{day.map((entry) => (
							<li key={entry.event.id}>
								<CalendarEventChip
									title={entry.event.title}
									timeText={entry.timeText}
									color={entry.color}
									layout="row"
									density="compact"
									rsvp={entry.event.myRsvp}
									status={entry.event.status}
									hasThread={entry.event.threadId !== ""}
									isRecurring={entry.event.recurrenceRule !== ""}
									zoneCertainty={entry.event.zoneCertainty}
									selected={entry.event.id === selectedEventId}
									onClick={() => actions.onSelectEvent(entry.event.id)}
								/>
							</li>
						))}
					</ul>
				</IntelligenceSection>
			)}
		</div>
	);
}
