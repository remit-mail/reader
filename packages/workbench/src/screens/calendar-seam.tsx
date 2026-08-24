/**
 * Option B — the calendar as a seam through the mail client.
 *
 * There is still a calendar destination in the nav, and Option A's grid is
 * still what it opens. What changes here is that the calendar also appears
 * wherever a decision about time is being made: beside the invitation, beside
 * the thread proposing three slots, under the reply that answers it. The bet is
 * that owning both sides is the whole advantage, and that an integrated
 * calendar which only ever lives on its own page throws that advantage away.
 *
 * The rules the surfaces below are built to keep:
 *
 * - nothing reaches the calendar without a person saying so, and a reading of
 *   a mail is drawn so it can never be mistaken for an agreed event;
 * - every event keeps the thread that made it, and the thread stays live;
 * - a time whose zone the mail never gave is shown as ambiguous and blocks the
 *   confirm until someone picks;
 * - the deterministic readings run first and the surface says which one fired;
 * - rejecting a reading offers a rule about the sender, not just a dismissal.
 *
 * All of it is real local state: answering the invite moves the day beside it,
 * confirming a suggestion puts it on the calendar, picking slots writes the
 * reply and lays provisional holds.
 */
import {
	Button,
	type CalendarAttendee,
	type CalendarEventData,
	cn,
	FlowScreen,
	FooterNav,
	MessageListPane,
	type RsvpState,
	useContainerWidth,
} from "@remit/ui";
import {
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	Sparkles,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { AttendeeContextCard } from "../components/attendee-context.js";
import { RejectedNotice } from "../components/rejected-notice.js";
import {
	type AvailabilityMark,
	AvailabilityStrip,
	SlotOfferRail,
} from "../components/seam/availability-strip.js";
import { InviteCard } from "../components/seam/invite-card.js";
import {
	composeReply,
	ReplyWithTimes,
} from "../components/seam/reply-with-times.js";
import { SeamEventDetail } from "../components/seam/seam-event-detail.js";
import {
	SuggestionCard,
	SuggestionDeck,
	SuggestionHeading,
} from "../components/seam/suggestion-strip.js";
import { ThreadTranscript } from "../components/seam/thread-view.js";
import {
	calendarsById,
	eventFromSuggestion,
	formatDayLabel,
	formatEventWhen,
	formatSuggestionWhen,
} from "../fixtures/calendar.js";
import {
	type BusyBlock,
	dayBlocks,
	dayFree,
	eventThreads,
	fromMinutes,
	HOLD_EXPIRY_LABEL,
	invite,
	inviteThreadId,
	PROPOSED_DATE,
	proposals,
	proposalThreadId,
	type SeamSuggestion,
	type SoftHold,
	seamSections,
	seamSuggestions,
	seamWeekEvents,
	slotOffers,
	type TimeSlot,
	toMinutes,
} from "../fixtures/calendar-mail.js";
import { clashesWith } from "../lib/agenda-time.js";
import { MailShell } from "./mail-shell.js";

/** Below this the reading pane has no room for a day beside the thread. */
const ASIDE_MIN_WIDTH = 620;

/** Half an hour is what Sofia asked for, and what a hold is worth. */
const OFFER_MINUTES = 30;

/** The full-screen flows the phone surface puts up, one at a time. */
export type PhoneFlow = "none" | "day" | "suggestions" | "attendee";

/**
 * Answering with times is three decisions, so it is three steps: read the day,
 * pick the half-hours, send the reply that offers them.
 */
const DAY_STEPS = ["The day", "Times", "Reply"] as const;

export interface CalendarSeamProps {
	width?: number;
	/** The thread open in the reading pane; empty leaves the list alone. */
	threadId?: string;
	inviteRsvp?: RsvpState;
	/** Start clocks already ticked into the reply. */
	pickedSlots?: string[];
	replyOpen?: boolean;
	replySent?: boolean;
	/** Desktop: whether the pending strip is unfolded in the list pane. */
	suggestionsOpen?: boolean;
	expandedSuggestionId?: string;
	/** Seeds a suggestion already dropped, so the sender rule is on offer. */
	rejectedSuggestionId?: string;
	senderRuleTaken?: boolean;
	/** Phone deck: which card is face up. */
	topSuggestionId?: string;
	selectedEventId?: string;
	activeAttendee?: string;
	flow?: PhoneFlow;
	/** Which step of the day flow a story opens on. */
	step?: number;
}

interface Rejected {
	entry: SeamSuggestion;
	index: number;
	ruled: boolean;
}

function clockOf(iso: string): string {
	return iso.slice(11, 16);
}

function isoAt(date: string, clock: string): string {
	return `${date}T${clock}:00+02:00`;
}

function conflictLabel(event: CalendarEventData): string {
	const calendar = calendarsById.get(event.calendarId);
	return `${event.title} · ${clockOf(event.start)} – ${clockOf(event.end)} · ${
		calendar?.name ?? "Calendar"
	} (${calendar?.accountLabel ?? ""})`;
}

/** The slots a story says are already ticked, resolved against the bare week. */
function seedSlots(starts: string[]): TimeSlot[] {
	return slotOffers(
		dayFree(dayBlocks(PROPOSED_DATE, seamWeekEvents)),
		OFFER_MINUTES,
		8,
	).filter((slot) => starts.includes(slot.start));
}

function busySummary(blocks: BusyBlock[]): string {
	const minutes = blocks
		.filter((block) => !block.declined)
		.reduce(
			(total, block) => total + toMinutes(block.end) - toMinutes(block.start),
			0,
		);
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours} h booked` : `${hours} h ${rest} m booked`;
}

export function CalendarSeam({
	width = 1440,
	threadId: initialThreadId = inviteThreadId,
	inviteRsvp: initialRsvp = "noReply",
	pickedSlots = [],
	replyOpen: initialReplyOpen = false,
	replySent = false,
	suggestionsOpen = false,
	expandedSuggestionId = "",
	rejectedSuggestionId = "",
	senderRuleTaken = false,
	topSuggestionId = "",
	selectedEventId = "",
	activeAttendee: initialAttendee = "",
	flow: initialFlow = "none",
	step: initialStep = 0,
}: CalendarSeamProps) {
	const isPhone = width < 768;

	const [threadId, setThreadId] = useState(initialThreadId);
	const [rsvp, setRsvp] = useState<RsvpState>(initialRsvp);
	const [replyOpen, setReplyOpen] = useState(
		initialReplyOpen || initialThreadId === proposalThreadId,
	);
	const [sent, setSent] = useState(replySent);
	const [holds, setHolds] = useState<SoftHold[]>(() =>
		replySent
			? seedSlots(pickedSlots).map((slot) => ({
					id: `hold_${slot.start}`,
					date: PROPOSED_DATE,
					startTime: slot.start,
					endTime: slot.end,
					expiresLabel: HOLD_EXPIRY_LABEL,
				}))
			: [],
	);
	const [confirmed, setConfirmed] = useState<CalendarEventData[]>([]);
	const [selected, setSelected] = useState(selectedEventId);
	const [attendee, setAttendee] = useState(initialAttendee);
	const [flow, setFlow] = useState<PhoneFlow>(initialFlow);
	const [step, setStep] = useState(initialStep);
	const [strip, setStrip] = useState(suggestionsOpen);
	const [expanded, setExpanded] = useState(expandedSuggestionId);
	const [zones, setZones] = useState<Record<string, string>>({});
	const [activeMarks, setActiveMarks] = useState<ReadonlySet<string>>(
		() => new Set(proposals.map((proposal) => proposal.id)),
	);

	const [pending, setPending] = useState<SeamSuggestion[]>(() => {
		const kept = seamSuggestions.filter(
			(entry) => entry.suggestion.id !== rejectedSuggestionId,
		);
		if (topSuggestionId === "") return kept;
		return [
			...kept.filter((entry) => entry.suggestion.id === topSuggestionId),
			...kept.filter((entry) => entry.suggestion.id !== topSuggestionId),
		];
	});
	const [rejected, setRejected] = useState<Rejected | null>(() => {
		const index = seamSuggestions.findIndex(
			(entry) => entry.suggestion.id === rejectedSuggestionId,
		);
		if (index === -1) return null;
		return { entry: seamSuggestions[index], index, ruled: senderRuleTaken };
	});
	const [rules, setRules] = useState<string[]>(() => {
		const seed = seamSuggestions.find(
			(entry) => entry.suggestion.id === rejectedSuggestionId,
		);
		return senderRuleTaken && seed ? [seed.suggestion.senderAddress] : [];
	});

	/* --- the calendar this option is arguing with ---------------------- */

	const inviteEvent: CalendarEventData | undefined =
		rsvp === "noReply"
			? undefined
			: {
					...invite.proposed,
					myRsvp: rsvp,
					status: rsvp === "tentative" ? "tentative" : "confirmed",
				};

	const events = useMemo(
		() => [
			...seamWeekEvents,
			...confirmed,
			...(inviteEvent ? [inviteEvent] : []),
		],
		[confirmed, inviteEvent],
	);

	const blocks = useMemo(() => dayBlocks(PROPOSED_DATE, events), [events]);
	const free = useMemo(() => dayFree(blocks), [blocks]);
	const offers = useMemo(
		() => slotOffers(free, OFFER_MINUTES, isPhone ? 8 : 6),
		[free, isPhone],
	);

	const [picked, setPicked] = useState<TimeSlot[]>(() =>
		seedSlots(pickedSlots),
	);
	const [draft, setDraft] = useState(() =>
		composeReply(
			"Sofia",
			formatDayLabel(PROPOSED_DATE),
			seedSlots(pickedSlots),
		),
	);

	const pickedKeys = useMemo(
		() => new Set(picked.map((slot) => slot.start)),
		[picked],
	);

	const togglePick = (slot: TimeSlot) => {
		const next = pickedKeys.has(slot.start)
			? picked.filter((item) => item.start !== slot.start)
			: [...picked, slot].sort((a, b) => a.start.localeCompare(b.start));
		setPicked(next);
		setDraft(composeReply("Sofia", formatDayLabel(PROPOSED_DATE), next));
		setReplyOpen(true);
		setSent(false);
	};

	const send = () => {
		setSent(true);
		setHolds(
			picked.map((slot) => ({
				id: `hold_${slot.start}`,
				date: PROPOSED_DATE,
				startTime: slot.start,
				endTime: slot.end,
				expiresLabel: HOLD_EXPIRY_LABEL,
			})),
		);
	};

	const release = () => {
		setHolds([]);
		setSent(false);
	};

	/* --- suggestions ---------------------------------------------------- */

	const confirmSuggestion = (entry: SeamSuggestion) => {
		const zone = zones[entry.suggestion.id] ?? "";
		const promoted = eventFromSuggestion(
			entry.suggestion,
			`evt_from_${entry.suggestion.id}`,
		);
		setConfirmed((prev) => [
			...prev,
			zone === ""
				? promoted
				: { ...promoted, zoneCertainty: "explicit", timeZone: zone },
		]);
		setPending((prev) =>
			prev.filter((item) => item.suggestion.id !== entry.suggestion.id),
		);
		setRejected(null);
	};

	const rejectSuggestion = (entry: SeamSuggestion) => {
		const index = pending.findIndex(
			(item) => item.suggestion.id === entry.suggestion.id,
		);
		setPending((prev) =>
			prev.filter((item) => item.suggestion.id !== entry.suggestion.id),
		);
		setRejected({ entry, index: Math.max(index, 0), ruled: false });
	};

	const undoReject = () => {
		if (!rejected) return;
		const restored = [...pending];
		restored.splice(rejected.index, 0, rejected.entry);
		setPending(restored);
		setRules((prev) =>
			prev.filter((rule) => rule !== rejected.entry.suggestion.senderAddress),
		);
		setRejected(null);
	};

	const takeRule = () => {
		if (!rejected) return;
		setRules((prev) => [...prev, rejected.entry.suggestion.senderAddress]);
		setRejected({ ...rejected, ruled: true });
	};

	/* --- what the panes render ------------------------------------------ */

	const selectedEvent = events.find((event) => event.id === selected);
	const thread = eventThreads[threadId];
	const openInvite = threadId === inviteThreadId;
	const openProposal = threadId === proposalThreadId;

	const conflicts = clashesWith(invite.proposed, events, {
		ignoreIds: [invite.proposed.id],
	});

	const proposalVerdicts = proposals.map((proposal) => ({
		proposal,
		clash: clashesWith(
			{
				start: isoAt(proposal.date, proposal.startTime),
				end: isoAt(proposal.date, proposal.endTime),
			},
			events,
			{ ignoreIds: [invite.proposed.id] },
		),
	}));

	function dayMarks(): AvailabilityMark[] {
		if (openInvite && rsvp === "noReply")
			return [
				{
					id: "invite",
					startTime: clockOf(invite.proposed.start),
					endTime: clockOf(invite.proposed.end),
					tone: "proposed",
					label: "Proposed",
				},
			];
		if (!openProposal) return [];
		return proposalVerdicts
			.filter(({ proposal }) => activeMarks.has(proposal.id))
			.map(({ proposal, clash }) => ({
				id: proposal.id,
				startTime: proposal.startTime,
				endTime: proposal.openEnded
					? fromMinutes(toMinutes(proposal.startTime) + 60)
					: proposal.endTime,
				tone: clash.length > 0 ? "clash" : "free",
				label: clash.length > 0 ? "Booked" : "Free",
			}));
	}

	const knownAttendees: CalendarAttendee[] = [
		...invite.proposed.attendees,
		...(selectedEvent?.attendees ?? []),
	];
	const attendeePerson = knownAttendees.find(
		(person) => person.email === attendee,
	);

	const topCard = pending[0];
	const topCardBlocked = Boolean(
		topCard?.zoneOptions && (zones[topCard.suggestion.id] ?? "") === "",
	);

	const suggestionCards = (touch: boolean) => (
		<div className="flex max-w-2xl flex-col gap-2 px-row-inset pb-3">
			{pending.map((entry) => (
				<SuggestionCard
					key={entry.suggestion.id}
					entry={entry}
					whenText={formatSuggestionWhen(entry.suggestion)}
					expanded={expanded === entry.suggestion.id}
					onToggleExpanded={() =>
						setExpanded((prev) =>
							prev === entry.suggestion.id ? "" : entry.suggestion.id,
						)
					}
					zoneChoice={zones[entry.suggestion.id] ?? ""}
					onZoneChoice={(id) =>
						setZones((prev) => ({ ...prev, [entry.suggestion.id]: id }))
					}
					onConfirm={() => confirmSuggestion(entry)}
					onReject={() => rejectSuggestion(entry)}
					onOpenThread={() => setThreadId(entry.suggestion.threadId)}
					touch={touch}
				/>
			))}
			{rejected && (
				<RejectedNotice
					title={rejected.entry.suggestion.title}
					sender={rejected.entry.suggestion.sender}
					senderAddress={rejected.entry.suggestion.senderAddress}
					ruled={rejected.ruled}
					onRule={takeRule}
					onDecline={() => setRejected(null)}
					onUndo={undoReject}
					touch={touch}
				/>
			)}
			{pending.length === 0 && !rejected && (
				<p className="py-4 text-center text-xs text-fg-subtle">
					Nothing in your mail is waiting on a decision about time.
				</p>
			)}
		</div>
	);

	const availability = (minuteHeight: number) => (
		<AvailabilityStrip
			blocks={blocks}
			holds={holds}
			marks={dayMarks()}
			picked={sent ? [] : picked}
			minuteHeight={minuteHeight}
			onSelectBlock={(eventId) => {
				setSelected(eventId);
				setFlow("none");
			}}
		/>
	);

	const slotRail = (touch: boolean) => (
		<div className="flex flex-col gap-1.5">
			<p className="text-2xs uppercase tracking-wider text-fg-subtle">
				Free, half an hour each
			</p>
			<SlotOfferRail
				slots={offers}
				picked={pickedKeys}
				onToggle={togglePick}
				touch={touch}
				scroll={touch}
			/>
		</div>
	);

	const dayPanel = (touch: boolean, minuteHeight: number) => (
		<div className="flex flex-col gap-3">
			{availability(minuteHeight)}
			{slotRail(touch)}
		</div>
	);

	const threadSlot = (messageId: string, touch: boolean, aside: boolean) => (
		<div className="mt-3 flex flex-col gap-3">
			{openInvite && messageId === "msg_invite_1" && (
				<>
					<InviteCard
						invite={invite}
						whenText={formatEventWhen(invite.proposed)}
						rsvp={rsvp}
						onRsvp={(next) => {
							setRsvp(next);
							if (next !== "declined") setReplyOpen(false);
						}}
						conflicts={conflicts}
						conflictLabel={conflictLabel}
						activeAttendee={attendee}
						onActivateAttendee={(email) => {
							setAttendee(email);
							if (touch) setFlow("attendee");
						}}
						onProposeOther={() => setReplyOpen(true)}
						touch={touch}
					/>
					{attendeePerson && !touch && (
						<AttendeeContextCard attendee={attendeePerson} />
					)}
				</>
			)}
			{openProposal && messageId === "msg_thursday_1" && (
				<div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3">
					<p className="text-2xs uppercase tracking-wider text-fg-subtle">
						Three times named in this mail, checked against{" "}
						{formatDayLabel(PROPOSED_DATE)}
					</p>
					<ul className="flex flex-col gap-1">
						{proposalVerdicts.map(({ proposal, clash }) => (
							<li key={proposal.id} className="flex items-center gap-2 text-xs">
								<span className="w-32 shrink-0 truncate tabular-nums text-fg">
									{proposal.phrase}
								</span>
								{clash.length > 0 ? (
									<span className="min-w-0 flex-1 truncate text-danger">
										{clash[0].title} is already there
									</span>
								) : (
									<span className="min-w-0 flex-1 truncate text-positive">
										Nothing booked
									</span>
								)}
							</li>
						))}
					</ul>
					{!aside && (
						<Button
							variant="secondary"
							size={touch ? "md" : "sm"}
							icon={<CalendarDays className="size-3.5" />}
							onClick={() => {
								setStep(0);
								setFlow("day");
							}}
							className={cn("self-start", touch && "min-h-11")}
						>
							See the day
						</Button>
					)}
				</div>
			)}
			{replyOpen && (
				<ReplyWithTimes
					slots={picked}
					dayLabel={formatDayLabel(PROPOSED_DATE)}
					draft={draft}
					onDraftChange={setDraft}
					onRemoveSlot={togglePick}
					onSend={send}
					sent={sent}
					onRelease={release}
					touch={touch}
				/>
			)}
		</div>
	);

	const threadBody = (touch: boolean, aside: boolean) =>
		thread ? (
			<ThreadTranscript
				messages={thread.messages}
				activeMarks={activeMarks}
				onMarkClick={(mark) =>
					setActiveMarks((prev) => {
						const next = new Set(prev);
						if (!next.delete(mark)) next.add(mark);
						return next;
					})
				}
				slotAfter={(messageId) => threadSlot(messageId, touch, aside)}
			/>
		) : null;

	const eventPane = (touch: boolean) =>
		selectedEvent ? (
			<SeamEventDetail
				event={selectedEvent}
				whenText={formatEventWhen(selectedEvent)}
				thread={eventThreads[selectedEvent.threadId]}
				activeAttendee={attendee}
				onActivateAttendee={(email) => {
					setAttendee(email);
					if (touch) setFlow("attendee");
				}}
				onClose={() => setSelected("")}
				touch={touch}
			/>
		) : null;

	if (isPhone) {
		let phoneBody: ReactNode = (
			<PhoneList
				pendingCount={pending.length}
				onOpenSuggestions={() => setFlow("suggestions")}
				selectedThreadId={threadId}
				onSelectThread={setThreadId}
			/>
		);
		if (thread)
			phoneBody = (
				<div className="flex h-full flex-col bg-surface">
					<header className="flex h-pane-header shrink-0 items-center gap-1 border-b border-line pl-1 pr-row-inset">
						<button
							type="button"
							aria-label="Back to the list"
							onClick={() => setThreadId("")}
							className="flex size-11 items-center justify-center rounded-md text-fg-subtle outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<ChevronLeft className="size-5" />
						</button>
						<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
							{thread.subject}
						</h1>
						<button
							type="button"
							onClick={() => {
								setStep(0);
								setFlow("day");
							}}
							aria-label="See the day"
							className="flex size-11 items-center justify-center rounded-md text-accent-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<CalendarDays className="size-5" />
						</button>
					</header>
					<div className="min-h-0 flex-1 overflow-y-auto pb-6">
						{threadBody(true, false)}
					</div>
				</div>
			);
		if (selectedEvent) phoneBody = eventPane(true);

		const daySummary = `${busySummary(blocks)} · ${offers.length} half-hours free`;
		const lastDayStep = DAY_STEPS.length - 1;

		const dayFlow = (
			<FlowScreen
				anchor="container"
				title={formatDayLabel(PROPOSED_DATE)}
				subtitle={daySummary}
				steps={DAY_STEPS}
				activeStep={step}
				onBack={() => (step === 0 ? setFlow("none") : setStep(step - 1))}
				onExit={() => setFlow("none")}
				footer={
					step === lastDayStep ? (
						<Button
							variant="primary"
							size="md"
							onClick={() => setFlow("none")}
							className="min-h-11 w-full"
						>
							Back to the thread
						</Button>
					) : (
						<FooterNav
							onBack={() => (step === 0 ? setFlow("none") : setStep(step - 1))}
							nextLabel={step === 0 ? "Pick times" : "Write the reply"}
							onNext={() => setStep(step + 1)}
							blockedReason={
								step === 1 && picked.length === 0
									? "Pick at least one half-hour to offer"
									: undefined
							}
						/>
					)
				}
			>
				{step === 0 && availability(0.52)}
				{step === 1 && (
					<div className="flex flex-col gap-3">
						{availability(0.34)}
						{slotRail(true)}
					</div>
				)}
				{step === 2 && (
					<ReplyWithTimes
						slots={picked}
						dayLabel={formatDayLabel(PROPOSED_DATE)}
						draft={draft}
						onDraftChange={setDraft}
						onRemoveSlot={togglePick}
						onSend={send}
						sent={sent}
						onRelease={release}
						touch
					/>
				)}
			</FlowScreen>
		);

		const suggestionsFlow = (
			<FlowScreen
				anchor="container"
				title="Waiting for you"
				subtitle={
					rules.length > 0
						? `${pending.length} left · ${rules.length} senders muted`
						: `${pending.length} left, none of it on your calendar`
				}
				steps={["Waiting for you"]}
				activeStep={0}
				onBack={() => setFlow("none")}
				onExit={() => setFlow("none")}
			>
				<SuggestionHeading
					count={pending.length}
					ruleCount={rules.length}
					touch
				/>
				<SuggestionDeck
					hasCard={pending.length > 0 || rejected !== null}
					remaining={pending.length}
					blocked={topCardBlocked}
					blockedReason="Pick a clock"
					onConfirm={() => {
						if (topCard) confirmSuggestion(topCard);
					}}
					onReject={() => {
						if (topCard) rejectSuggestion(topCard);
					}}
				>
					{rejected ? (
						<RejectedNotice
							title={rejected.entry.suggestion.title}
							sender={rejected.entry.suggestion.sender}
							senderAddress={rejected.entry.suggestion.senderAddress}
							ruled={rejected.ruled}
							onRule={takeRule}
							onDecline={() => setRejected(null)}
							onUndo={undoReject}
							touch
						/>
					) : (
						topCard && (
							<SuggestionCard
								entry={topCard}
								whenText={formatSuggestionWhen(topCard.suggestion)}
								expanded={expanded === topCard.suggestion.id}
								onToggleExpanded={() =>
									setExpanded((prev) =>
										prev === topCard.suggestion.id ? "" : topCard.suggestion.id,
									)
								}
								zoneChoice={zones[topCard.suggestion.id] ?? ""}
								onZoneChoice={(id) =>
									setZones((prev) => ({
										...prev,
										[topCard.suggestion.id]: id,
									}))
								}
								onConfirm={() => confirmSuggestion(topCard)}
								onReject={() => rejectSuggestion(topCard)}
								onOpenThread={() => {
									setThreadId(topCard.suggestion.threadId);
									setFlow("none");
								}}
								touch
							/>
						)
					)}
				</SuggestionDeck>
			</FlowScreen>
		);

		const attendeeFlow = attendeePerson && (
			<FlowScreen
				anchor="container"
				title={attendeePerson.name}
				subtitle={attendeePerson.email}
				steps={["Guest"]}
				activeStep={0}
				onBack={() => setFlow("none")}
				onExit={() => setFlow("none")}
			>
				<AttendeeContextCard
					attendee={attendeePerson}
					className="w-full border-0 p-0"
				/>
			</FlowScreen>
		);

		return (
			<MailShell
				width={width}
				selectedNavId="mbx_work_inbox"
				calendarNav="shown"
				list={phoneBody}
				overlay={
					flow === "day"
						? dayFlow
						: flow === "suggestions"
							? suggestionsFlow
							: flow === "attendee"
								? attendeeFlow
								: undefined
				}
			/>
		);
	}

	let readingBody: ReactNode;
	if (selectedEvent) readingBody = eventPane(false);
	else if (thread)
		readingBody = (
			<SeamReading
				subject={thread.subject}
				dayLabel={formatDayLabel(PROPOSED_DATE)}
				daySummary={`${busySummary(blocks)} · ${offers.length} half-hours free`}
				body={(aside) => threadBody(false, aside)}
				day={(minuteHeight) => dayPanel(false, minuteHeight)}
			/>
		);

	return (
		<MailShell
			width={width}
			selectedNavId="mbx_work_inbox"
			calendarNav="shown"
			list={
				<DesktopList
					pendingCount={pending.length}
					ruleCount={rules.length}
					open={strip}
					onToggleOpen={() => setStrip((value) => !value)}
					cards={suggestionCards(false)}
					selectedThreadId={threadId}
					onSelectThread={(id) => {
						setThreadId(id);
						setSelected("");
					}}
				/>
			}
			readingPane={readingBody ? "default" : "off"}
			reading={readingBody ?? undefined}
		/>
	);
}

/* ------------------------------------------------------------------ */
/* Desktop                                                             */
/* ------------------------------------------------------------------ */

function DesktopList({
	pendingCount,
	ruleCount,
	open,
	onToggleOpen,
	cards,
	selectedThreadId,
	onSelectThread,
}: {
	pendingCount: number;
	ruleCount: number;
	open: boolean;
	onToggleOpen: () => void;
	cards: ReactNode;
	selectedThreadId: string;
	onSelectThread: (id: string) => void;
}) {
	return (
		<section className="flex h-full w-full flex-col bg-surface">
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
					Inbox
				</h1>
				<span className="shrink-0 text-2xs text-fg-subtle">3 unread</span>
			</header>

			<div className="shrink-0 border-b border-line bg-surface-sunken">
				<SuggestionHeading count={pendingCount} ruleCount={ruleCount}>
					<button
						type="button"
						aria-expanded={open}
						onClick={onToggleOpen}
						className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs text-accent-2 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
					>
						{open ? "Hide" : "Review"}
						<ChevronRight
							className={cn("size-3 transition-transform", open && "rotate-90")}
						/>
					</button>
				</SuggestionHeading>
				{open ? (
					<div className="max-h-[26rem] overflow-y-auto">{cards}</div>
				) : (
					<p className="px-row-inset pb-2 text-2xs text-fg-subtle">
						None of them are on your calendar, and none of them will be until
						you say so.
					</p>
				)}
			</div>

			<div className="min-h-0 flex-1">
				<MessageListPane
					hideHeader
					flatList
					listTitle="Inbox"
					sections={seamSections()}
					selectedThreadId={selectedThreadId}
					onSelectThread={onSelectThread}
					isDesktop
				/>
			</div>
		</section>
	);
}

function SeamReading({
	subject,
	dayLabel,
	daySummary,
	body,
	day,
}: {
	subject: string;
	dayLabel: string;
	daySummary: string;
	body: (aside: boolean) => ReactNode;
	day: (minuteHeight: number) => ReactNode;
}) {
	const [ref, paneWidth] = useContainerWidth(900);
	const aside = (paneWidth ?? 0) >= ASIDE_MIN_WIDTH;

	return (
		<div ref={ref} className="flex h-full w-full bg-surface">
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
					<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
						{subject}
					</h1>
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto pb-6">
					{body(aside)}
					{!aside && (
						<div className="px-row-inset pt-3">
							<h2 className="pb-1 text-sm font-medium text-fg">{dayLabel}</h2>
							<p className="pb-2 text-2xs text-fg-subtle">{daySummary}</p>
							{day(0.5)}
						</div>
					)}
				</div>
			</div>

			{aside && (
				<aside className="flex w-72 shrink-0 flex-col border-l border-line bg-surface-sunken">
					<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
						<CalendarDays className="size-4 shrink-0 text-fg-subtle" />
						<h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-fg">
							{dayLabel}
						</h2>
					</header>
					<div className="min-h-0 flex-1 overflow-y-auto px-row-inset py-2">
						<p className="pb-2 text-2xs text-fg-subtle">{daySummary}</p>
						{day(0.62)}
					</div>
				</aside>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Phone                                                               */
/* ------------------------------------------------------------------ */

function PhoneList({
	pendingCount,
	onOpenSuggestions,
	selectedThreadId,
	onSelectThread,
}: {
	pendingCount: number;
	onOpenSuggestions: () => void;
	selectedThreadId: string;
	onSelectThread: (id: string) => void;
}) {
	return (
		<section className="flex h-full w-full flex-col bg-surface">
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
					Inbox
				</h1>
			</header>
			<button
				type="button"
				onClick={onOpenSuggestions}
				className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-row-inset text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Sparkles className="size-4 shrink-0 text-accent-2" aria-hidden />
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-medium text-fg">
						{pendingCount} waiting for you
					</span>
					<span className="block truncate text-2xs text-fg-subtle">
						Read out of mail. None of it is on your calendar.
					</span>
				</span>
				<ChevronRight className="size-4 shrink-0 text-fg-subtle" />
			</button>
			<div className="min-h-0 flex-1">
				<MessageListPane
					hideHeader
					flatList
					listTitle="Inbox"
					sections={seamSections()}
					selectedThreadId={selectedThreadId}
					onSelectThread={onSelectThread}
					isDesktop={false}
				/>
			</div>
		</section>
	);
}
