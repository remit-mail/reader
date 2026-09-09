/**
 * Option B, re-shaped: the seam is a tab in the info panel rather than a layout
 * of its own. The panel already renders whenever a thread is open, so a clash
 * check lands exactly where the decision is, and both of its hosts — the rail
 * from 1280px up, the drawer below it — inherit the strip for free.
 *
 * Every surface here comes from `@remit/ui`. The screen only decides which of
 * this option's fixtures the open thread is about, and holds the answers.
 */
import type {
	CalendarClash,
	CalendarEventData,
	CalendarProposal,
	CalendarSlotPick,
	IntelligenceCalendarData,
	IntelligenceTabId,
	RsvpState,
} from "@remit/ui";
import { useMemo, useState } from "react";
import {
	calendarsById,
	formatDayLabel,
	formatEventWhen,
	formatSuggestionWhen,
} from "../fixtures/calendar.js";
import {
	dayBlocks,
	dayFree,
	invite,
	inviteThreadId,
	overlapping,
	PROPOSED_DATE,
	proposals,
	proposalThreadId,
	seamSections,
	seamSuggestions,
	seamWeekEvents,
	slotOffers,
} from "../fixtures/calendar-mail.js";
import { q3Intelligence, q3Thread } from "../fixtures/workspace.js";
import { MailShell } from "./mail-shell.js";

/** Half an hour is what Sofia asked for, and what an offer is worth. */
const OFFER_MINUTES = 30;

function clockOf(iso: string): string {
	return iso.slice(11, 16);
}

function isoAt(date: string, clock: string): string {
	return `${date}T${clock}:00+02:00`;
}

function toClash(event: CalendarEventData): CalendarClash {
	const calendar = calendarsById.get(event.calendarId);
	return {
		id: event.id,
		label: `${event.title} · ${clockOf(event.start)} – ${clockOf(event.end)} · ${
			calendar?.name ?? "Calendar"
		} (${calendar?.accountLabel ?? ""})`,
	};
}

export interface CalendarTabProps {
	width?: number;
	/** The thread the panel is answering about. */
	threadId?: string;
	tab?: IntelligenceTabId;
	inviteRsvp?: RsvpState;
}

export function CalendarTab({
	width = 1440,
	threadId = inviteThreadId,
	tab = "calendar",
	inviteRsvp = "noReply",
}: CalendarTabProps) {
	const [rsvp, setRsvp] = useState<RsvpState>(inviteRsvp);
	const [picked, setPicked] = useState<string[]>([]);
	const [dropped, setDropped] = useState<string[]>([]);
	const [selectedEventId, setSelectedEventId] = useState("");
	const [offering, setOffering] = useState(threadId === proposalThreadId);

	const blocks = useMemo(() => dayBlocks(PROPOSED_DATE, seamWeekEvents), []);
	const slots: CalendarSlotPick[] = useMemo(
		() => slotOffers(dayFree(blocks), OFFER_MINUTES, 6),
		[blocks],
	);

	const verdicts: CalendarProposal[] = proposals.map((proposal) => {
		const clash = overlapping(
			{
				start: isoAt(proposal.date, proposal.startTime),
				end: isoAt(proposal.date, proposal.endTime),
			},
			seamWeekEvents,
		);
		return {
			id: proposal.id,
			phrase: proposal.phrase,
			clashTitle: clash.length === 0 ? "" : clash[0].title,
		};
	});

	const inviteCalendar = calendarsById.get(invite.proposed.calendarId);
	const onInvite = threadId === inviteThreadId;

	const day = seamWeekEvents
		.filter(
			(event) => !event.allDay && event.start.slice(0, 10) === PROPOSED_DATE,
		)
		.sort((a, b) => a.start.localeCompare(b.start))
		.map((event) => ({
			event,
			timeText: clockOf(event.start),
			color: calendarsById.get(event.calendarId)?.color ?? "cal-1",
		}));

	const data: IntelligenceCalendarData = {
		invite: onInvite
			? {
					invite,
					whenText: formatEventWhen(invite.proposed),
					calendarName: inviteCalendar?.name ?? "Calendar",
					color: inviteCalendar?.color ?? "cal-1",
					clashes: overlapping(invite.proposed, seamWeekEvents).map(toClash),
					rsvp,
				}
			: undefined,
		prose: offering
			? {
					dayLabel: formatDayLabel(PROPOSED_DATE),
					proposals: verdicts,
					slots,
					picked,
				}
			: undefined,
		suggestions: seamSuggestions
			.filter((entry) => entry.suggestion.threadId === threadId)
			.filter((entry) => !dropped.includes(entry.suggestion.id))
			.map((entry) => ({
				suggestion: entry.suggestion,
				whenText: formatSuggestionWhen(entry.suggestion),
			})),
		day,
		dayLabel: formatDayLabel(PROPOSED_DATE),
	};

	return (
		<MailShell
			width={width}
			selectedNavId="mbx_work_inbox"
			calendarNav="shown"
			sections={seamSections()}
			listTitle="Inbox"
			thread={q3Thread}
			selectedThreadId={threadId}
			intelligence={q3Intelligence}
			intelligenceTab={tab}
			calendar={{
				data,
				selectedEventId,
				actions: {
					onAddInvite: () => setRsvp("accepted"),
					onTentativeInvite: () => setRsvp("tentative"),
					onDeclineInvite: () => setRsvp("declined"),
					onReopenInvite: () => setRsvp("noReply"),
					onOfferOtherTimes: () => setOffering(true),
					onRemoveInvite: () => setRsvp("noReply"),
					onOpenNewerInvite: () => undefined,
					onToggleSlot: (slot) =>
						setPicked((prev) =>
							prev.includes(slot.startTime)
								? prev.filter((start) => start !== slot.startTime)
								: [...prev, slot.startTime],
						),
					onAddSuggestion: (id) => setDropped((prev) => [...prev, id]),
					onReviewSuggestion: () => undefined,
					onDismissSuggestion: (id) => setDropped((prev) => [...prev, id]),
					onOpenThread: () => undefined,
					onSelectEvent: setSelectedEventId,
				},
			}}
		/>
	);
}
