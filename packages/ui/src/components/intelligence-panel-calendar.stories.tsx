import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useState } from "react";
import type { RsvpState } from "./calendar-types.js";
import type { IntelligenceCalendarData } from "./intelligence-calendar.js";
import {
	airlineSender,
	cancelledInvite,
	flightConfirmation,
	inviteWithClash,
	inviteWithoutClash,
	nothingAboutTime,
	organiserSender,
	proseTimeThread,
	supersededInvite,
	thursdayProse,
} from "./intelligence-calendar-fixtures.js";
import type {
	IntelligenceData,
	IntelligenceTabId,
} from "./intelligence-panel.js";
import { IntelligencePanel } from "./intelligence-panel.js";

/**
 * Option B, re-shaped. The calendar is not a second page you go to; it is the
 * half of the info panel that answers what a message would cost. It is a tab
 * rather than a longer column because the panel already carries the sender, and
 * because the question only exists while a decision about time is open.
 *
 * The strip lives on `IntelligencePanel` itself, so both hosts inherit it: the
 * rail that shows from 1280px up, and the drawer every narrower layout opens in
 * its place. Both are framed below, because a tab strip that works in a 304px
 * rail and breaks in a full-height sheet is not one component.
 *
 * The rule under every state here: nothing reaches the calendar unless a person
 * presses the button, and pressing it tells the organiser nothing. This plan
 * sends no reply, so the card says so where the press happens.
 */
const meta: Meta = {
	title: "Screens/Kit/IntelligencePanel/Calendar tab",
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj;

/* ------------------------------------------------------------------ */
/* A panel that answers, so the review is a click-through not a picture */
/* ------------------------------------------------------------------ */

function PanelDemo({
	sender,
	calendar,
	initialTab = "calendar",
	hideCloseButton,
	touch,
	className,
}: {
	sender: IntelligenceData;
	calendar: IntelligenceCalendarData;
	initialTab?: IntelligenceTabId;
	hideCloseButton?: boolean;
	touch?: boolean;
	className?: string;
}) {
	const [tab, setTab] = useState<IntelligenceTabId>(initialTab);
	const [rsvp, setRsvp] = useState<RsvpState>(
		calendar.invite?.rsvp ?? "noReply",
	);
	const [removed, setRemoved] = useState(false);
	const [offering, setOffering] = useState(calendar.prose !== undefined);
	const [picked, setPicked] = useState<string[]>([]);
	const [dropped, setDropped] = useState<string[]>([]);
	const [selectedEventId, setSelectedEventId] = useState("");
	const [lastAction, setLastAction] = useState("");

	const prose = offering
		? { ...(calendar.prose ?? thursdayProse), picked }
		: undefined;

	const data: IntelligenceCalendarData = {
		...calendar,
		invite:
			calendar.invite && !removed ? { ...calendar.invite, rsvp } : undefined,
		prose,
		suggestions: calendar.suggestions.filter(
			(entry) => !dropped.includes(entry.suggestion.id),
		),
	};

	return (
		<div className="flex h-full min-w-0 flex-col">
			<IntelligencePanel
				className={className}
				data={sender}
				calendar={{
					data,
					selectedEventId,
					actions: {
						onAddInvite: () => setRsvp("accepted"),
						onTentativeInvite: () => setRsvp("tentative"),
						onDeclineInvite: () => setRsvp("declined"),
						onReopenInvite: () => setRsvp("noReply"),
						onOfferOtherTimes: () => setOffering(true),
						onRemoveInvite: () => setRemoved(true),
						onOpenNewerInvite: () =>
							setLastAction("would open revision 2 of the invitation"),
						onToggleSlot: (slot) =>
							setPicked((prev) =>
								prev.includes(slot.startTime)
									? prev.filter((start) => start !== slot.startTime)
									: [...prev, slot.startTime],
							),
						onAddSuggestion: (id, timeZone) => {
							setDropped((prev) => [...prev, id]);
							setLastAction(
								timeZone === ""
									? `added ${id} to the calendar`
									: `added ${id} on ${timeZone}`,
							);
						},
						onReviewSuggestion: (id) =>
							setLastAction(`would open the editor on ${id}`),
						onDismissSuggestion: (id) => setDropped((prev) => [...prev, id]),
						onOpenThread: (threadId) =>
							setLastAction(`would open thread ${threadId}`),
						onSelectEvent: setSelectedEventId,
					},
				}}
				tab={tab}
				onTabChange={setTab}
				hideCloseButton={hideCloseButton}
				touch={touch}
			/>
			{lastAction !== "" && (
				<p className="shrink-0 border-t border-line bg-surface-sunken px-row-inset py-2 text-2xs text-fg-subtle">
					Prototype: {lastAction}
				</p>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Host 1: the rail, 1280px and up                                     */
/* ------------------------------------------------------------------ */

function RailHost({
	subject,
	children,
}: {
	subject: string;
	children: ReactNode;
}) {
	return (
		<div className="flex h-[860px] w-[1440px] overflow-hidden rounded-lg border border-line bg-canvas">
			<div className="w-14 shrink-0 border-r border-line bg-surface-sunken" />
			<div className="w-56 shrink-0 border-r border-line bg-surface-sunken" />
			<div className="w-80 shrink-0 border-r border-line bg-surface" />
			<div className="flex min-w-0 flex-1 flex-col bg-surface">
				<header className="flex h-pane-header shrink-0 items-center border-b border-line px-row-inset">
					<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
						{subject}
					</h1>
				</header>
				<p className="px-row-inset py-4 text-sm text-fg-muted">
					The message. The panel beside it is the surface under review.
				</p>
			</div>
			{children}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Host 2: the drawer, below 1280px                                    */
/* ------------------------------------------------------------------ */

function DrawerHost({
	subject,
	children,
}: {
	subject: string;
	children: ReactNode;
}) {
	return (
		<div className="relative flex h-[860px] w-[900px] overflow-hidden rounded-lg border border-line bg-canvas">
			<div className="w-72 shrink-0 border-r border-line bg-surface" />
			<div className="flex min-w-0 flex-1 flex-col bg-surface">
				<header className="flex h-pane-header shrink-0 items-center border-b border-line px-row-inset">
					<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
						{subject}
					</h1>
				</header>
			</div>
			<div className="absolute inset-0 bg-black/40" />
			<aside className="absolute inset-y-0 right-0 flex w-[420px] flex-col border-l border-line bg-surface shadow-2xl">
				<header className="flex h-pane-header shrink-0 items-center justify-between border-b border-line px-row-inset">
					<span className="text-sm font-semibold text-fg">Message details</span>
					<span className="text-2xs text-fg-subtle">
						the drawer's own close
					</span>
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
			</aside>
		</div>
	);
}

const KICKOFF = "Invitation: Billing migration kickoff — Thu 11 Jun, 14:00";
const THURSDAY = "Can we meet Thursday?";
const FLIGHT = "Your booking is confirmed — KL1693 Amsterdam to Lisbon";
const PLAIN = "Re: Reading pane density — a vote for calmer";

function rail(
	subject: string,
	sender: IntelligenceData,
	calendar: IntelligenceCalendarData,
	initialTab: IntelligenceTabId = "calendar",
): Story {
	return {
		render: () => (
			<RailHost subject={subject}>
				<PanelDemo
					sender={sender}
					calendar={calendar}
					initialTab={initialTab}
					className="h-full"
				/>
			</RailHost>
		),
	};
}

function drawer(
	subject: string,
	sender: IntelligenceData,
	calendar: IntelligenceCalendarData,
	initialTab: IntelligenceTabId = "calendar",
): Story {
	return {
		render: () => (
			<DrawerHost subject={subject}>
				<PanelDemo
					sender={sender}
					calendar={calendar}
					initialTab={initialTab}
					hideCloseButton
					touch
					className="h-full w-full border-l-0"
				/>
			</DrawerHost>
		),
	};
}

/* ------------------------------------------------------------------ */
/* The states the review is about, in the rail                         */
/* ------------------------------------------------------------------ */

/**
 * An invitation, and the thing every mail client leaves out. The clash is with
 * a dentist appointment on the personal account: two calendars, two accounts,
 * one afternoon, and it is stated above the button rather than discovered
 * after. The button reads "Add to calendar" because that is all pressing it
 * does — Priya learns nothing from it, and the card says so.
 */
export const InviteWithAClash = rail(KICKOFF, organiserSender, inviteWithClash);

/**
 * The same invitation an hour later. Nothing is booked over it, and the panel
 * says that too — silence there would read as "not checked", which is the same
 * as not knowing.
 */
export const InviteWithNothingBooked = rail(
	KICKOFF,
	organiserSender,
	inviteWithoutClash,
);

/**
 * A later message carried a higher SEQUENCE for the same UID. The stale one is
 * dimmed and its buttons are gone: answering a revision that has been replaced
 * puts the wrong hour on the calendar, so the card offers the newer one instead
 * of an answer.
 */
export const SupersededInvitation = rail(
	KICKOFF,
	organiserSender,
	supersededInvite,
);

/**
 * METHOD:CANCEL on something already accepted. Reader does not take it off by
 * itself: nothing leaves the calendar without a person saying so, for the same
 * reason nothing reaches it that way. Until then the event is still there and
 * the card says why.
 */
export const CancellationAwaitingYou = rail(
	KICKOFF,
	organiserSender,
	cancelledInvite,
);

/**
 * A flight confirmation, read out of a machine-readable booking block rather
 * than an attached invitation. The airline printed 20:25 for the arrival and
 * never said whose clock; Lisbon runs an hour behind. Add stays refused until
 * someone picks one, because booking the wrong hour is worse than asking.
 */
export const FlightConfirmation = rail(
	FLIGHT,
	airlineSender,
	flightConfirmation,
);

/**
 * "Can we do Thursday?" — three hours named in prose, each checked against the
 * day. Two are already booked and that is readable without leaving the message.
 * The half-hours under them go into the reply as plain text; ticking one books
 * nothing.
 */
export const ProseTimeThread = rail(THURSDAY, organiserSender, proseTimeThread);

/**
 * A message with no time in it. The tab is still there — it is part of the
 * panel, not something that appears and disappears — and it says plainly that
 * there is nothing to decide rather than showing an empty frame.
 */
export const EmptyCalendarTab = rail(PLAIN, organiserSender, nothingAboutTime);

/**
 * The Sender tab, unchanged. Every section that was in the panel before is
 * where it was; the strip above it is the only thing that is new.
 */
export const SenderTabUnchanged = rail(
	KICKOFF,
	organiserSender,
	inviteWithClash,
	"sender",
);

/* ------------------------------------------------------------------ */
/* The same states in the drawer, which every layout under 1280 opens  */
/* ------------------------------------------------------------------ */

/** The clash check in the drawer. Same panel, same tabs, larger hit targets. */
export const DrawerInviteWithAClash = drawer(
	KICKOFF,
	organiserSender,
	inviteWithClash,
);

/** Nothing booked, in the drawer. */
export const DrawerInviteWithNothingBooked = drawer(
	KICKOFF,
	organiserSender,
	inviteWithoutClash,
);

/** The superseded revision, in the drawer. */
export const DrawerSupersededInvitation = drawer(
	KICKOFF,
	organiserSender,
	supersededInvite,
);

/** The cancellation still waiting on the reader, in the drawer. */
export const DrawerCancellationAwaitingYou = drawer(
	KICKOFF,
	organiserSender,
	cancelledInvite,
);

/** The flight and its unsettled clock, in the drawer. */
export const DrawerFlightConfirmation = drawer(
	FLIGHT,
	airlineSender,
	flightConfirmation,
);

/** The hours named in prose, in the drawer. */
export const DrawerProseTimeThread = drawer(
	THURSDAY,
	organiserSender,
	proseTimeThread,
);

/** Nothing about a time, in the drawer. */
export const DrawerEmptyCalendarTab = drawer(
	PLAIN,
	organiserSender,
	nothingAboutTime,
);

/** The Sender tab in the drawer, unchanged from what it was before the strip. */
export const DrawerSenderTabUnchanged = drawer(
	KICKOFF,
	organiserSender,
	inviteWithClash,
	"sender",
);
