import { CalendarDays, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";
import { CalendarFailureNote } from "./calendar-failure-note.js";
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
import {
	EventSuggestionCard,
	settleZone,
	ZONE_UNSETTLED_REASON,
} from "./event-suggestion-card.js";
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
	/** An answer is on its way to the server. */
	busy?: boolean;
	/** Why the last answer did not land. Empty when it did. */
	failure?: string;
	reportHref?: string;
	/** Why nothing can be written to a calendar yet; holds Add and Remove. */
	addBlocked?: ReactNode;
	/**
	 * Who the mail came from, which is who muting stops — not always the
	 * organiser. Without it the card offers no mute.
	 */
	sender?: string;
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
	/** What became of the last copy of the picked times. */
	copy?: "idle" | "copied" | "failed";
	/** The picked times as text, offered to select by hand when copying failed. */
	copyText?: string;
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
	/** An answer to the top reading is on its way to the server. */
	suggestionsBusy?: boolean;
	/** What the tab could not read. Empty when it read everything. */
	failure?: string;
	/** Why the last answer to a reading did not land, stated beside the deck. */
	suggestionsFailure?: string;
	/** A prefilled issue report for either failure above. */
	reportHref?: string;
	/** Why no reading can be added yet; holds the deck's Add. */
	addBlocked?: ReactNode;
}

/**
 * What the tab can do. An optional action is one a host may have no way to
 * carry out, and the control behind it is left off rather than drawn dead.
 */
export interface IntelligenceCalendarActions {
	onAddInvite: () => void;
	onTentativeInvite?: () => void;
	onDeclineInvite: () => void;
	onReopenInvite?: () => void;
	onMuteInvite?: () => void;
	onOfferOtherTimes: () => void;
	onRemoveInvite?: () => void;
	onOpenNewerInvite?: () => void;
	onToggleSlot: (slot: CalendarSlotPick) => void;
	onCopySlots?: () => void;
	onAddSuggestion: (suggestionId: string, timeZone: string) => void;
	onReviewSuggestion?: (suggestionId: string, timeZone: string) => void;
	onDismissSuggestion: (suggestionId: string) => void;
	onOpenThread?: (threadId: string) => void;
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
	const {
		invite,
		prose,
		suggestions,
		day,
		dayLabel,
		suggestionsBusy = false,
		failure = "",
		suggestionsFailure = "",
		reportHref,
		addBlocked,
	} = data;
	const { onReviewSuggestion, onOpenThread } = actions;
	const [zoneChoices, setZoneChoices] = useState<Record<string, string>>({});
	const top = suggestions[0];
	const topChoice =
		top === undefined ? "" : (zoneChoices[top.suggestion.id] ?? "");
	const topSettlement =
		top === undefined ? undefined : settleZone(top.suggestion, topChoice);
	const picked = new Set(prose?.picked ?? []);
	const nothingToSay =
		failure === "" &&
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
			{failure !== "" && (
				<CalendarFailureNote
					text={failure}
					reportHref={reportHref}
					className="mx-row-inset mt-3"
				/>
			)}

			{invite && (
				<IntelligenceSection label="Invitation">
					<CalendarInviteCard
						invite={invite.invite}
						whenText={invite.whenText}
						calendarName={invite.calendarName}
						color={invite.color}
						clashes={invite.clashes}
						rsvp={invite.rsvp}
						busy={invite.busy}
						failure={invite.failure}
						reportHref={invite.reportHref}
						addBlocked={invite.addBlocked}
						mute={
							actions.onMuteInvite && invite.sender
								? { sender: invite.sender, onMute: actions.onMuteInvite }
								: undefined
						}
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
				<IntelligenceSection
					label={
						prose.proposals.length > 0
							? `Times named · ${prose.dayLabel}`
							: `Other times · ${prose.dayLabel}`
					}
				>
					<ul
						className={cn(
							"flex flex-col gap-1",
							prose.proposals.length === 0 && "hidden",
						)}
					>
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
					{actions.onCopySlots ? (
						<div className="mt-2 flex flex-col gap-1.5">
							<Button
								variant="secondary"
								size={touch ? "md" : "sm"}
								icon={<Copy className="size-3.5" />}
								onClick={actions.onCopySlots}
								disabled={picked.size === 0}
								className={cn("self-start", touch && "min-h-11")}
							>
								Copy picked times
							</Button>
							{prose.copy === "copied" && (
								<p role="status" className="text-2xs text-positive">
									Copied. Paste them into your reply.
								</p>
							)}
							{prose.copy === "failed" && (
								<div role="alert" className="flex flex-col gap-1">
									<p className="text-2xs text-danger">
										This page can't copy for you. Select the times below and copy
										them yourself.
									</p>
									<textarea
										readOnly
										aria-label="Picked times"
										value={prose.copyText ?? ""}
										onFocus={(event) => event.currentTarget.select()}
										rows={2}
										className="w-full resize-none rounded-md border border-line bg-surface p-1.5 text-xs text-fg"
									/>
								</div>
							)}
							<p className="text-2xs text-fg-subtle">
								Picked slots are copied as plain text. Nothing is booked.
							</p>
						</div>
					) : (
						<p className="mt-1.5 text-2xs text-fg-subtle">
							Picked slots go into the reply as plain text. Nothing is booked.
						</p>
					)}
				</IntelligenceSection>
			)}

			{suggestions.length > 0 && (
				<IntelligenceSection label="Read out of this thread">
					<CalendarSuggestionDeck
						hasCard={top !== undefined}
						remaining={suggestions.length}
						blocked={topSettlement !== undefined && !topSettlement.settled}
						blockedReason={ZONE_UNSETTLED_REASON}
						onConfirm={() => {
							if (top && topSettlement?.settled && addBlocked === undefined)
								actions.onAddSuggestion(
									top.suggestion.id,
									topSettlement.timeZone,
								);
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
								zoneChoice={topChoice}
								onZoneChoice={(timeZone) =>
									setZoneChoices((prev) => ({
										...prev,
										[top.suggestion.id]: timeZone,
									}))
								}
								onAdd={(timeZone) =>
									actions.onAddSuggestion(top.suggestion.id, timeZone)
								}
								onReview={
									onReviewSuggestion &&
									((timeZone) =>
										onReviewSuggestion(top.suggestion.id, timeZone))
								}
								onDismiss={() => actions.onDismissSuggestion(top.suggestion.id)}
								onOpenThread={
									onOpenThread && (() => onOpenThread(top.suggestion.threadId))
								}
								busy={suggestionsBusy}
								addBlocked={addBlocked !== undefined}
								touch={touch}
							/>
						)}
					</CalendarSuggestionDeck>
					{addBlocked !== undefined && (
						<div className="mt-2 rounded-md border border-warning/40 bg-warning-soft p-2 text-xs text-fg">
							{addBlocked}
						</div>
					)}
					{suggestionsFailure !== "" && (
						<CalendarFailureNote
							text={suggestionsFailure}
							reportHref={reportHref}
							className="mt-2"
						/>
					)}

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
