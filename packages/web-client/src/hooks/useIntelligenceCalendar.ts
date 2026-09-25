/**
 * The calendar half of the intelligence panel for the open message.
 *
 * The invitation, the day it lands on and the answers all come from the server:
 * the suggestions the message produced, the events already on that day, and the
 * busy time merged across every calendar. What is held here is only what the
 * reader is in the middle of — the half-hours ticked, whether the offer is open,
 * which answer is on its way and why the last one was refused — and none of it
 * outlives the message it is about.
 */
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type {
	CalendarDayEntry,
	CalendarSlotPick,
	CalendarSuggestionIntel,
	IntelligenceCalendarActions,
	IntelligenceCalendarSurface,
	IntelligenceTabId,
} from "@remit/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	calendarUnavailable,
	calendarWriteGate,
} from "@/components/calendar/CalendarUnavailable";
import {
	calendarWindowOfDays,
	isDrawnInstance,
	readCalendarInstanceId,
	type SuggestionAnswer,
	toCalendarEventData,
	useCalendarEventWindow,
	useCalendarFreeBusyWeeks,
	useCalendarSuggestionAnswers,
	useCalendars,
	useMessageCalendarSuggestions,
} from "@/hooks/calendar";
import { formatDayLabel, formatInstantClock } from "@/lib/calendar-format";
import {
	type CalendarSuggestion,
	clashesOver,
	inviteStanding,
	isFromInvitation,
	slotOffersOn,
	slotsAsText,
	suggestionDate,
	suggestionWhen,
	toCalendarInvite,
	toEventSuggestion,
} from "@/lib/calendar-suggestion";
import { calendarReportHref } from "@/lib/calendar-report";
import { useOpenEventOnCalendar } from "@/routing";

/** What the reader is in the middle of, for one message and no other. */
interface Working {
	messageId: string;
	tab: IntelligenceTabId | undefined;
	offering: boolean;
	picked: string[];
	copy: "idle" | "copied" | "failed";
	answering: string;
	/** The card the last refusal was about, and what it said. */
	failure: { suggestionId: string; text: string };
}

const fresh = (messageId: string): Working => ({
	messageId,
	tab: undefined,
	offering: false,
	picked: [],
	copy: "idle",
	answering: "",
	failure: { suggestionId: "", text: "" },
});

/** Pending cards first, then the latest revision, so the card answers the newest ask. */
const byUrgency = (a: CalendarSuggestion, b: CalendarSuggestion): number => {
	const pending = Number(b.state === "Pending") - Number(a.state === "Pending");
	return pending !== 0 ? pending : b.sequence - a.sequence;
};

const refusal = (what: string, answer: SuggestionAnswer): string =>
	answer.kind === "refused"
		? `Couldn't ${what}: ${answer.message} Try again, or answer from your calendar app.`
		: "";

export interface IntelligenceCalendar {
	surface: IntelligenceCalendarSurface;
	tab: IntelligenceTabId;
	onTabChange: (tab: IntelligenceTabId) => void;
}

export function useIntelligenceCalendar(
	thread: RemitImapThreadMessageResponse,
): IntelligenceCalendar {
	const messageId = thread.messageId;
	const { suggestions, isLoading, error } =
		useMessageCalendarSuggestions(messageId);
	const calendarsRead = useCalendars();
	const {
		calendars,
		defaultCalendarId,
		colorByCalendarId,
		timeZoneByCalendarId,
	} = calendarsRead;
	const gate = calendarWriteGate(calendarsRead);
	const answers = useCalendarSuggestionAnswers();

	const openEvent = useOpenEventOnCalendar();

	const [held, setHeld] = useState<Working>(() => fresh(messageId));
	const working = held.messageId === messageId ? held : fresh(messageId);
	const onScreen = useRef(messageId);
	onScreen.current = messageId;
	// An answer can come back after the reader has moved on, and what it says
	// is about the message it was given for, not the one now open.
	const update = (change: Partial<Working>) => {
		if (onScreen.current !== messageId) return;
		setHeld((prev) => ({
			...(prev.messageId === messageId ? prev : fresh(messageId)),
			...change,
		}));
	};

	const invitation = useMemo(
		() =>
			suggestions
				.filter(isFromInvitation)
				.filter((suggestion) => inviteStanding(suggestion) !== undefined)
				.sort(byUrgency)[0],
		[suggestions],
	);
	const readings = suggestions.filter(
		(suggestion) => suggestion !== invitation && suggestion.state === "Pending",
	);

	const anchor = invitation ?? readings[0];
	const date = anchor ? suggestionDate(anchor) : "";
	const dayWindow = calendarWindowOfDays(date === "" ? "1970-01-01" : date, 1);
	const dayEvents = useCalendarEventWindow({
		...dayWindow,
		calendarIds: [],
		enabled: date !== "",
	});
	const freeBusy = useCalendarFreeBusyWeeks(date === "" ? [] : [dayWindow]);

	const context = {
		threadId: thread.threadId,
		threadSubject: thread.subject ?? "",
		calendarId: defaultCalendarId,
	};
	const senderName = thread.fromName ?? thread.fromEmail ?? "";
	const reportHref = calendarReportHref(
		working.failure.text || "the invitations in a message could not be read",
	);
	const addBlocked = calendarUnavailable(gate, reportHref);

	const answer = (
		suggestionId: string,
		what: string,
		request: () => Promise<SuggestionAnswer>,
	) => {
		update({ answering: suggestionId, failure: { suggestionId, text: "" } });
		void request().then((result) =>
			update({
				answering: "",
				failure: { suggestionId, text: refusal(what, result) },
			}),
		);
	};

	const invitationId = invitation?.suggestionId ?? "";
	const inviteFailure =
		working.failure.suggestionId === invitationId ? working.failure.text : "";
	const otherFailure =
		working.failure.suggestionId === invitationId ? "" : working.failure.text;

	const standing = invitation ? inviteStanding(invitation) : undefined;
	const invite =
		invitation && standing
			? {
					invite: toCalendarInvite(invitation, standing.state, {
						...context,
						senderName,
					}),
					whenText: suggestionWhen(invitation),
					calendarName:
						calendars.find((calendar) => calendar.id === defaultCalendarId)
							?.name ?? "Calendar",
					color: colorByCalendarId[defaultCalendarId] ?? "cal-1",
					clashes:
						standing.state === "pending"
							? clashesOver(
									{ start: invitation.dtStart, end: invitation.dtEnd },
									freeBusy.spans,
								)
							: [],
					rsvp: standing.rsvp,
					busy: working.answering === invitation.suggestionId,
					failure: inviteFailure,
					reportHref,
					addBlocked,
					sender: senderName,
				}
			: undefined;

	const slots: CalendarSlotPick[] =
		date === "" ? [] : slotOffersOn(date, freeBusy.spans);

	const day: CalendarDayEntry[] = dayEvents.instances
		.filter(isDrawnInstance)
		.filter((instance) => !instance.allDay)
		.sort((a, b) => a.start.localeCompare(b.start))
		.map((instance) => {
			const event = toCalendarEventData(
				instance,
				timeZoneByCalendarId[instance.calendarId] ?? "",
			);
			return {
				event,
				timeText: formatInstantClock(instance.start),
				color: colorByCalendarId[instance.calendarId] ?? "cal-1",
			};
		});

	const deck: CalendarSuggestionIntel[] = readings.map((suggestion) => ({
		suggestion: toEventSuggestion(suggestion, {
			...context,
			sender: senderName,
		}),
		whenText: suggestionWhen(suggestion),
	}));

	const readFailure =
		error === null
			? ""
			: "Couldn't read the invitations in this message. Reopen it to try again.";

	const cancellation = invitation?.method === "Cancel";
	const copyText =
		date === "" ? "" : slotsAsText(date, slots, working.picked);

	const actions: IntelligenceCalendarActions = {
		onAddInvite: () =>
			answer(invitationId, "add this to your calendar", () =>
				answers.accept(invitationId, defaultCalendarId),
			),
		onDeclineInvite: () =>
			answer(invitationId, "decline this", () => answers.decline(invitationId)),
		onMuteInvite: () =>
			answer(invitationId, "stop these invitations", () =>
				answers.dismiss(invitationId, true),
			),
		onRemoveInvite: cancellation
			? () =>
					answer(invitationId, "take this off your calendar", () =>
						answers.accept(invitationId, defaultCalendarId),
					)
			: undefined,
		onReopenInvite: cancellation
			? () =>
					answer(invitationId, "keep this on your calendar", () =>
						answers.dismiss(invitationId, false),
					)
			: undefined,
		onOfferOtherTimes: () => update({ offering: true }),
		onToggleSlot: (slot) =>
			update({
				copy: "idle",
				picked: working.picked.includes(slot.startTime)
					? working.picked.filter((start) => start !== slot.startTime)
					: [...working.picked, slot.startTime],
			}),
		onCopySlots: () => {
			// Outside a secure context — plain http on a tailnet host — the
			// browser exposes no clipboard at all, so the absence is the failure.
			const clipboard: Clipboard | undefined = navigator.clipboard;
			if (!clipboard) {
				update({ copy: "failed" });
				return;
			}
			void Promise.resolve()
				.then(() => clipboard.writeText(copyText))
				.then(() => update({ copy: "copied" }))
				.catch(() => update({ copy: "failed" }));
		},
		onAddSuggestion: (suggestionId) =>
			answer(suggestionId, "add this to your calendar", () =>
				answers.accept(suggestionId, defaultCalendarId),
			),
		onDismissSuggestion: (suggestionId) =>
			answer(suggestionId, "dismiss this", () =>
				answers.dismiss(suggestionId, false),
			),
		onSelectEvent: (eventId) => {
			const { calendarObjectId, recurrenceId } =
				readCalendarInstanceId(eventId);
			openEvent(date, calendarObjectId, recurrenceId);
		},
	};

	const aboutTime = invite !== undefined || deck.length > 0 || error !== null;
	const latched = working.tab !== undefined;

	// The tab is decided once, when the message's suggestions have been read,
	// and then held: answering the last card must not pull the tab out from
	// under the reader, and a read still in flight must not decide it.
	useEffect(() => {
		if (isLoading || latched) return;
		setHeld((prev) =>
			prev.messageId === messageId && prev.tab !== undefined
				? prev
				: {
						...(prev.messageId === messageId ? prev : fresh(messageId)),
						tab: aboutTime ? "calendar" : "sender",
					},
		);
	}, [isLoading, latched, aboutTime, messageId]);

	return {
		surface: {
			data: {
				invite,
				prose:
					working.offering && date !== ""
						? {
								dayLabel: formatDayLabel(date),
								proposals: [],
								slots,
								picked: working.picked,
								copy: working.copy,
								copyText,
							}
						: undefined,
				suggestions: deck,
				day,
				dayLabel: date === "" ? "" : formatDayLabel(date),
				suggestionsBusy: working.answering !== "" && !invite?.busy,
				failure: readFailure,
				suggestionsFailure: otherFailure,
				reportHref,
				addBlocked,
			},
			actions,
		},
		tab: working.tab ?? "sender",
		onTabChange: (tab) => update({ tab }),
	};
}
