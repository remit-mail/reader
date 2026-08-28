/**
 * Option C — the calendar as one scrolling strip of days.
 *
 * The week grid is not the default here. It is a zoom level you drop into for a
 * day that has earned it, and the thing you come back out to is a list that
 * never paginates and keeps your place. The state is real: creating an event
 * adds it, unticking a calendar takes it off the strip, changing the density
 * changes what a day costs in pixels, and scrolling to either end loads more
 * days without a seam.
 */
import {
	AgendaComposer,
	type AgendaDensity,
	AgendaDensityControl,
	AgendaFlow,
	AgendaPhraseField,
	type AgendaScrollTarget,
	addDays,
	Button,
	CalendarDateNav,
	type CalendarEventData,
	CalendarList,
	type CalendarViewId,
	CalendarViewSwitch,
	type CustomRecurrence,
	CustomRecurrenceDialog,
	CustomRecurrenceEditor,
	cn,
	type Density,
	datesBetween,
	defaultCustomRecurrence,
	defaultEndDate,
	EventDetail,
	type EventDraft,
	type EventSuggestion,
	EventSuggestionCard,
	FlowScreen,
	FooterNav,
	type FreeStretch,
	FreeTimeList,
	formatCustomRecurrence,
	formatMinute,
	freeAhead,
	monthLabel,
	NextUpCard,
	PhraseReading,
	PositionMap,
	ReadingPane,
	type RecurrenceScope,
	RecurrenceScopePrompt,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
	readCustomRecurrence,
	readNextUp,
	type ThreadData,
	useContainerWidth,
} from "@remit/ui";
import {
	ArrowLeft,
	MailX,
	SlidersHorizontal,
	Sparkles,
	Trash2,
	Wand2,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { AttendeeContextCard } from "../components/attendee-context.js";
import { CalendarGrid, type SlotPick } from "../components/calendar-grid.js";
import {
	EVENT_WIZARD_LAST_STEP,
	EVENT_WIZARD_STEPS,
	EventEditPage,
	EventWizardStep,
	ONE_OFF_EDIT_STEPS,
	SCOPED_EDIT_STEPS,
} from "../components/event-wizard.js";
import { RejectedNotice } from "../components/rejected-notice.js";
import {
	allCalendarIds,
	buildDay,
	calendars,
	calendarsById,
	eventFromSuggestion,
	formatDayLabel,
	formatEventWhen,
	formatSuggestionWhen,
	HOME_ZONE,
	NOW_ISO,
	TODAY,
	threadFor,
} from "../fixtures/calendar.js";
import {
	agendaEvents,
	agendaSuggestions,
	STRIP_FIRST_DATE,
	STRIP_LAST_DATE,
} from "../fixtures/calendar-agenda.js";
import { type ChoicePicks, parseAgendaPhrase } from "../lib/agenda-phrase.js";
import { applyDraft, applyScopedEdit } from "../lib/calendar-edit.js";
import { railShare } from "../lib/calendar-rail.js";
import { MailShell } from "./mail-shell.js";

/** Wednesday 10 June 2026, 09:30 — the same fixed now as the mail fixtures. */
const NOW = new Date(2026, 5, 10, 9, 30);

/** Below this the surface has no room for a rail beside the strip. */
const RAIL_MIN_WIDTH = 700;
/** Below this the readings beside the strip would squeeze it. */
const CONTEXT_MIN_WIDTH = 1040;

const colorByCalendarId = Object.fromEntries(
	calendars.map((calendar) => [calendar.id, calendar.color]),
);

/** Days held either side of the focus before the reader scrolls for more. */
const LEAD_IN = 10;
const LEAD_OUT = 24;
const PAGE = 14;

function clampDate(date: string): string {
	if (date < STRIP_FIRST_DATE) return STRIP_FIRST_DATE;
	if (date > STRIP_LAST_DATE) return STRIP_LAST_DATE;
	return date;
}

function emptyDraft(): EventDraft {
	return {
		title: "",
		date: TODAY,
		startTime: "10:00",
		endTime: "11:00",
		allDay: false,
		calendarId: calendars[0].id,
		location: "",
		guests: "",
		notes: "",
		repeat: "",
	};
}

function draftFromSlot(pick: SlotPick): EventDraft {
	return {
		...emptyDraft(),
		date: pick.date,
		startTime: pick.allDay ? "" : pick.startTime,
		endTime: pick.allDay ? "" : pick.endTime,
		allDay: pick.allDay,
	};
}

function draftFromEvent(event: CalendarEventData): EventDraft {
	return {
		title: event.title,
		date: event.start.slice(0, 10),
		startTime: event.allDay ? "" : event.start.slice(11, 16),
		endTime: event.allDay ? "" : event.end.slice(11, 16),
		allDay: event.allDay,
		calendarId: event.calendarId,
		location: event.location,
		guests: event.attendees.map((attendee) => attendee.name).join(", "),
		notes: event.notes,
		repeat: event.recurrenceRule,
	};
}

function draftFromPhrase(phrase: string, picks: ChoicePicks): EventDraft {
	const parse = parseAgendaPhrase(phrase, NOW, picks);
	return {
		...emptyDraft(),
		title: parse.title,
		date: parse.date,
		startTime: parse.startTime === "" ? "10:00" : parse.startTime,
		endTime: parse.endTime === "" ? "11:00" : parse.endTime,
		location: parse.location,
		guests: parse.attendees.join(", "),
		repeat: parse.repeat,
	};
}

/** An event with nothing on it yet — what a create starts from. */
function blankEvent(id: string): CalendarEventData {
	return {
		id,
		calendarId: calendars[0].id,
		title: "",
		start: "",
		end: "",
		allDay: false,
		location: "",
		notes: "",
		attendees: [],
		myRsvp: "accepted",
		threadId: "",
		threadSubject: "",
		timeZone: HOME_ZONE,
		zoneCertainty: "local",
		recurrenceRule: "",
		seriesId: "",
		seriesException: false,
		status: "confirmed",
	};
}

function eventFromDraft(draft: EventDraft, id: string): CalendarEventData {
	return applyDraft(blankEvent(id), draft);
}

function shiftDate(
	date: string,
	view: CalendarViewId,
	direction: 1 | -1,
): string {
	const cursor = new Date(`${date}T00:00:00Z`);
	if (view === "year")
		cursor.setUTCFullYear(cursor.getUTCFullYear() + direction);
	else if (view === "month")
		cursor.setUTCMonth(cursor.getUTCMonth() + direction);
	else if (view === "day") cursor.setUTCDate(cursor.getUTCDate() + direction);
	else cursor.setUTCDate(cursor.getUTCDate() + 7 * direction);
	return cursor.toISOString().slice(0, 10);
}

function headerTitle(
	view: CalendarViewId,
	visibleDate: string,
	focusDate: string,
): string {
	if (view === "agenda") return monthLabel(visibleDate);
	if (view === "day") return formatDayLabel(focusDate);
	return monthLabel(focusDate);
}

/** The phone screens that take the whole surface, one at a time. */
type Flow =
	| "none"
	| "editor"
	| "event"
	| "calendars"
	| "suggestions"
	| "thread"
	| "attendee";

/** A reading the reader has just dropped, and what was offered along with it. */
interface DroppedSuggestion {
	suggestion: EventSuggestion;
	/** Where it sat in the column, so undo puts it back rather than on the end. */
	index: number;
	ruled: boolean;
}

function mutedCountLabel(count: number): string {
	return count === 1 ? "1 sender muted" : `${count} senders muted`;
}

type Panel =
	| { kind: "none" }
	| { kind: "create" }
	| {
			kind: "edit";
			eventId: string;
			/** Empty for a one-off; otherwise the answer the scope question got. */
			scope: RecurrenceScope | "";
	  }
	| { kind: "scope"; eventId: string };

export interface CalendarAgendaProps {
	width?: number;
	/** Agenda is the default; the grids are the zoom levels off it. */
	view?: CalendarViewId;
	date?: string;
	density?: AgendaDensity;
	selectedEventId?: string;
	hiddenCalendarIds?: string[];
	/** Seeds the quick-entry field and unfolds the form under it. */
	phrase?: string;
	/** Answers a reading the phrase left open, so a story can show the other one. */
	picks?: ChoicePicks;
	/**
	 * Opens the phone flow a story is about. A thread and a guest are opened
	 * from the screen that names them, not seeded.
	 */
	flow?: Exclude<Flow, "thread" | "attendee">;
	/**
	 * Opens the mail behind a thread id, which is the only way to show one the
	 * mailbox no longer has.
	 */
	openThreadId?: string;
	/** Which step of the create walk the flow opens on. */
	step?: number;
	/** Opens the custom-rule editor over the form it belongs to. */
	customRepeat?: "closed" | "open";
	scopeForEventId?: string;
}

export function CalendarAgenda({
	width = 1440,
	view: initialView = "agenda",
	date: initialDate = TODAY,
	density: initialDensity = "pills",
	selectedEventId = "",
	hiddenCalendarIds = [],
	phrase: initialPhrase = "",
	picks: initialPicks = {},
	flow: initialFlow = "none",
	openThreadId: initialThreadId = "",
	step: initialStep = 0,
	customRepeat = "closed",
	scopeForEventId = "",
}: CalendarAgendaProps) {
	const isPhone = width < 768;
	const token = useRef(0);

	const [view, setView] = useState<CalendarViewId>(initialView);
	const [focusDate, setFocusDate] = useState(initialDate);
	const [visibleDate, setVisibleDate] = useState(initialDate);
	const [density, setDensity] = useState<AgendaDensity>(initialDensity);
	const [events, setEvents] = useState<CalendarEventData[]>(agendaEvents);
	const [suggestions, setSuggestions] =
		useState<EventSuggestion[]>(agendaSuggestions);
	const [dropped, setDropped] = useState<DroppedSuggestion | null>(null);
	const [rules, setRules] = useState<string[]>([]);
	const [zones, setZones] = useState<Record<string, string>>({});
	const [selected, setSelected] = useState(selectedEventId);
	const [visible, setVisible] = useState(
		() =>
			new Set(allCalendarIds.filter((id) => !hiddenCalendarIds.includes(id))),
	);
	const [phrase, setPhrase] = useState(initialPhrase);
	const [picks, setPicks] = useState<ChoicePicks>(initialPicks);
	const [draft, setDraft] = useState<EventDraft>(() =>
		initialPhrase === ""
			? emptyDraft()
			: draftFromPhrase(initialPhrase, initialPicks),
	);
	const [expanded, setExpanded] = useState(false);
	const [panel, setPanel] = useState<Panel>(() => {
		if (scopeForEventId !== "")
			return { kind: "scope", eventId: scopeForEventId };
		return initialPhrase === "" ? { kind: "none" } : { kind: "create" };
	});
	const [flow, setFlow] = useState<Flow>(
		initialThreadId !== "" && isPhone ? "thread" : initialFlow,
	);
	const [threadFrom, setThreadFrom] = useState<Flow>(initialFlow);
	const [openThreadId, setOpenThreadId] = useState(initialThreadId);
	const [activeAttendee, setActiveAttendee] = useState("");
	const [step, setStep] = useState(initialStep);
	const [customRule, setCustomRule] = useState<CustomRecurrence | null>(() =>
		customRepeat === "open" ? defaultCustomRecurrence(draft.date) : null,
	);
	const [range, setRange] = useState(() => ({
		from: clampDate(addDays(initialDate, -LEAD_IN)),
		to: clampDate(addDays(initialDate, LEAD_OUT)),
	}));
	const [scrollTarget, setScrollTarget] = useState<AgendaScrollTarget>();

	const shown = useMemo(
		() => events.filter((event) => visible.has(event.calendarId)),
		[events, visible],
	);
	const days = useMemo(
		() =>
			datesBetween(range.from, range.to).map((date) => buildDay(date, shown)),
		[range, shown],
	);
	const dayOf = useMemo(() => (date: string) => buildDay(date, shown), [shown]);
	const nextUp = useMemo(() => readNextUp(days, NOW_ISO), [days]);
	const openTime = useMemo(() => freeAhead(days, NOW_ISO, 4), [days]);
	const parse = useMemo(
		() => parseAgendaPhrase(phrase, NOW, picks),
		[phrase, picks],
	);
	const selectedEvent = events.find((event) => event.id === selected);
	const openedThread = threadFor(openThreadId);
	const openedGuest = selectedEvent?.attendees.find(
		(guest) => guest.email === activeAttendee,
	);
	const isMuted = (suggestion: EventSuggestion) =>
		rules.includes(suggestion.senderAddress);
	const visibleSuggestions = suggestions.filter(
		(suggestion) => !isMuted(suggestion),
	);

	const goTo = (date: string) => {
		const target = clampDate(date);
		setFocusDate(target);
		setVisibleDate(target);
		if (target < range.from || target > range.to)
			setRange({
				from: clampDate(addDays(target, -LEAD_IN)),
				to: clampDate(addDays(target, LEAD_OUT)),
			});
		token.current += 1;
		setScrollTarget({ date: target, token: token.current });
	};

	const changeView = (next: CalendarViewId) => {
		setView(next);
		if (next === "agenda") goTo(focusDate);
	};

	const zoomDay = (date: string) => {
		setFocusDate(date);
		setVisibleDate(date);
		setView("day");
	};

	const toggleCalendar = (calendarId: string) =>
		setVisible((previous) => {
			const next = new Set(previous);
			if (!next.delete(calendarId)) next.add(calendarId);
			return next;
		});

	const toggleAccount = (accountId: string, nextVisible: boolean) =>
		setVisible((previous) => {
			const next = new Set(previous);
			for (const calendar of calendars) {
				if (calendar.accountId !== accountId) continue;
				if (nextVisible) next.add(calendar.id);
				else next.delete(calendar.id);
			}
			return next;
		});

	const typePhrase = (next: string) => {
		setPhrase(next);
		setDraft(draftFromPhrase(next, picks));
		setPanel({ kind: "create" });
	};

	const answerChoice = (choiceId: string, optionId: string) => {
		const next = { ...picks, [choiceId]: optionId };
		setPicks(next);
		setDraft(draftFromPhrase(phrase, next));
	};

	const openSlot = (pick: SlotPick) => {
		setPhrase("");
		setPicks({});
		setExpanded(false);
		setDraft(draftFromSlot(pick));
		setPanel({ kind: "create" });
		setStep(0);
		if (isPhone) setFlow("editor");
	};

	const openFree = (stretch: FreeStretch) => {
		goTo(stretch.date);
		openSlot({
			date: stretch.date,
			startTime: formatMinute(stretch.startMinute),
			endTime: formatMinute(
				Math.min(stretch.startMinute + 60, stretch.endMinute),
			),
			allDay: false,
		});
	};

	const openEvent = (eventId: string) => {
		setSelected(eventId);
		setOpenThreadId("");
		setActiveAttendee("");
		if (isPhone) setFlow("event");
	};

	/**
	 * A guest is a correspondent, so their name on an event is a way into what
	 * they have written. On a desktop the row opens what they wrote underneath
	 * it; a thumb gets a screen rather than a card sitting under the finger.
	 */
	const openGuest = (email: string) => {
		setActiveAttendee(email);
		if (isPhone && email !== "") setFlow("attendee");
	};

	const closeGuest = () => {
		setActiveAttendee("");
		setFlow("event");
	};

	/**
	 * The mail an event or a suggestion came out of, opened in the pane the
	 * calendar was read in. On a phone it is a screen, and back is the screen it
	 * was opened from rather than the strip underneath both.
	 */
	const openThread = (threadId: string) => {
		setOpenThreadId(threadId);
		if (!isPhone) return;
		setThreadFrom(flow);
		setFlow("thread");
	};

	const closeThread = () => {
		setOpenThreadId("");
		if (isPhone) setFlow(threadFrom);
	};

	const startEdit = (event: CalendarEventData) => {
		if (event.seriesId !== "") {
			setPanel({ kind: "scope", eventId: event.id });
			if (isPhone) setFlow("editor");
			return;
		}
		setPhrase("");
		setExpanded(false);
		setDraft(draftFromEvent(event));
		setPanel({ kind: "edit", eventId: event.id, scope: "" });
		if (isPhone) setFlow("editor");
	};

	const applyScope = (eventId: string, scope: RecurrenceScope) => {
		const event = events.find((candidate) => candidate.id === eventId);
		if (!event) return;
		setExpanded(scope !== "this");
		setDraft(draftFromEvent(event));
		setPanel({ kind: "edit", eventId, scope });
	};

	const dismiss = () => {
		setPanel({ kind: "none" });
		setPhrase("");
		setPicks({});
		setStep(0);
		setFlow("none");
	};

	const commit = () => {
		if (panel.kind === "create") {
			const id = `evt_new_${events.length}`;
			setEvents((previous) => [...previous, eventFromDraft(draft, id)]);
			setSelected(id);
			setOpenThreadId("");
			goTo(draft.date);
		}
		if (panel.kind === "edit")
			setEvents((previous) =>
				applyScopedEdit(previous, panel.eventId, draft, panel.scope),
			);
		dismiss();
	};

	/**
	 * Dropping a reading is the only moment the reader has said anything about
	 * the sender, so it is the moment to ask — and the rule is never taken for
	 * them, never silent, and never one-way.
	 */
	const dropSuggestion = (suggestion: EventSuggestion) => {
		const index = suggestions.findIndex((item) => item.id === suggestion.id);
		setSuggestions((previous) =>
			previous.filter((item) => item.id !== suggestion.id),
		);
		setDropped({ suggestion, index: Math.max(index, 0), ruled: false });
	};

	const muteSender = () => {
		if (!dropped) return;
		setRules((previous) => [...previous, dropped.suggestion.senderAddress]);
		setDropped({ ...dropped, ruled: true });
	};

	const restoreDropped = () => {
		if (!dropped) return;
		setSuggestions((previous) => {
			const next = [...previous];
			next.splice(dropped.index, 0, dropped.suggestion);
			return next;
		});
		setRules((previous) =>
			previous.filter((rule) => rule !== dropped.suggestion.senderAddress),
		);
		setDropped(null);
	};

	/**
	 * Lifting the rule takes the claim down with it: a notice still saying
	 * nothing more will come from that address would be telling the reader the
	 * opposite of what is now true, with no way to take the rule again.
	 */
	const unmuteSender = (address: string) => {
		setRules((previous) => previous.filter((rule) => rule !== address));
		setDropped((previous) =>
			previous && previous.suggestion.senderAddress === address
				? { ...previous, ruled: false }
				: previous,
		);
	};

	const acceptSuggestion = (suggestion: EventSuggestion, timeZone: string) => {
		const id = `evt_from_${suggestion.id}`;
		const promoted = eventFromSuggestion(suggestion, id, timeZone);
		setEvents((previous) => [...previous, promoted]);
		setSuggestions((previous) =>
			previous.filter((item) => item.id !== suggestion.id),
		);
		setSelected(id);
		setOpenThreadId("");
		setFlow("none");
		goTo(promoted.start.slice(0, 10));
	};

	const deleteSelected = (event: CalendarEventData) => {
		setEvents((previous) =>
			previous.filter((candidate) => candidate.id !== event.id),
		);
		setSelected("");
		setFlow("none");
	};

	const gridDensity: Density = density === "detail" ? "comfortable" : "compact";

	const grid = (
		<div className="min-h-0 flex-1">
			<CalendarGrid
				view={view}
				date={focusDate}
				events={shown}
				colorByCalendarId={colorByCalendarId}
				density={gridDensity}
				selectedEventId={selected}
				onSelectEvent={openEvent}
				onPickSlot={openSlot}
				onRangeChange={() => undefined}
			/>
		</div>
	);

	const strip = (
		<AgendaFlow
			days={days}
			calendars={calendars}
			density={density}
			today={TODAY}
			focusDate={focusDate}
			selectedEventId={selected}
			onSelectEvent={openEvent}
			onPickSlot={openSlot}
			onZoomDay={zoomDay}
			onReachStart={() =>
				setRange((previous) => ({
					...previous,
					from: clampDate(addDays(previous.from, -PAGE)),
				}))
			}
			onReachEnd={() =>
				setRange((previous) => ({
					...previous,
					to: clampDate(addDays(previous.to, PAGE)),
				}))
			}
			onVisibleDayChange={setVisibleDate}
			scrollTarget={scrollTarget}
			touch={isPhone}
			todayLead={
				isPhone ? (
					<div className="border-b border-line bg-surface-sunken p-3">
						<NextUpCard
							nextUp={nextUp}
							calendars={calendars}
							today={TODAY}
							onSelectEvent={openEvent}
							onGoTo={goTo}
							touch
						/>
					</div>
				) : undefined
			}
		/>
	);

	const composer = (touch: boolean) => {
		if (panel.kind === "scope") {
			const event = events.find((candidate) => candidate.id === panel.eventId);
			if (!event) return null;
			return (
				<RecurrenceScopePrompt
					title={event.title}
					ruleText={event.recurrenceRule}
					instanceText={formatDayLabel(event.start.slice(0, 10))}
					onChoose={(scope) => applyScope(event.id, scope)}
					onCancel={dismiss}
					touch={touch}
				/>
			);
		}
		return (
			<AgendaComposer
				phrase={phrase}
				onPhraseChange={typePhrase}
				parse={parse}
				picks={picks}
				onPick={answerChoice}
				draft={draft}
				onDraftChange={setDraft}
				calendars={calendars}
				expanded={expanded}
				onToggleExpanded={() => setExpanded((open) => !open)}
				onSave={commit}
				onCancel={dismiss}
				saveLabel={panel.kind === "edit" ? "Save" : "Add"}
				repeatEditable={repeatEditable}
				onCustomRepeat={openCustomRepeat}
				open={panel.kind !== "none"}
				onOpen={() => {
					if (panel.kind === "none") setPanel({ kind: "create" });
				}}
				touch={touch}
			/>
		);
	};

	const suggestionColumn = (touch: boolean) => {
		const column: ReactNode[] = suggestions.map((suggestion) =>
			isMuted(suggestion) ? null : (
				<EventSuggestionCard
					key={suggestion.id}
					suggestion={suggestion}
					whenText={formatSuggestionWhen(suggestion)}
					zoneChoice={zones[suggestion.id] ?? ""}
					onZoneChoice={(timeZone) =>
						setZones((previous) => ({
							...previous,
							[suggestion.id]: timeZone,
						}))
					}
					onAdd={(timeZone) => acceptSuggestion(suggestion, timeZone)}
					onReview={() => goTo(suggestion.start.slice(0, 10))}
					onDismiss={() => dropSuggestion(suggestion)}
					onOpenThread={() => openThread(suggestion.threadId)}
					touch={touch}
				/>
			),
		);

		if (dropped)
			column.splice(
				dropped.index,
				0,
				<RejectedNotice
					key="dropped"
					title={dropped.suggestion.title}
					sender={dropped.suggestion.sender}
					senderAddress={dropped.suggestion.senderAddress}
					ruled={dropped.ruled}
					onRule={muteSender}
					onDecline={() => setDropped(null)}
					onUndo={restoreDropped}
					touch={touch}
				/>,
			);

		return (
			<section className="flex flex-col gap-2">
				<h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
					<Sparkles className="size-3 shrink-0" />
					<span className="min-w-0 flex-1 truncate">
						{rules.length === 0
							? "Waiting for you"
							: `Waiting for you · ${mutedCountLabel(rules.length)}`}
					</span>
				</h3>
				{rules.length > 0 && (
					<ul className="flex flex-col gap-1">
						{rules.map((address) => (
							<li key={address} className="flex items-center gap-2">
								<span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
									{address}
								</span>
								<button
									type="button"
									aria-label={`Unmute ${address}`}
									onClick={() => unmuteSender(address)}
									className={cn(
										"shrink-0 rounded-sm text-2xs font-medium text-accent-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
										touch && "min-h-11 px-1",
									)}
								>
									Unmute
								</button>
							</li>
						))}
					</ul>
				)}
				{visibleSuggestions.length === 0 && !dropped ? (
					<p className="text-xs text-fg-subtle">
						Nothing unread in your mail looks like a date.
					</p>
				) : (
					column
				)}
			</section>
		);
	};

	const detail = (onClose: () => void) =>
		selectedEvent ? (
			<EventDetail
				event={selectedEvent}
				calendar={calendarsById.get(selectedEvent.calendarId) ?? calendars[0]}
				whenText={formatEventWhen(selectedEvent)}
				onEdit={() => startEdit(selectedEvent)}
				onDelete={() => deleteSelected(selectedEvent)}
				onOpenThread={
					selectedEvent.threadId === ""
						? undefined
						: () => openThread(selectedEvent.threadId)
				}
				onClose={onClose}
				activeAttendee={activeAttendee}
				onActivateAttendee={openGuest}
				renderAttendeeContext={(guest) => (
					<AttendeeContextCard attendee={guest} className="w-full" />
				)}
			/>
		) : null;

	const repeatEditable = panel.kind !== "edit" || panel.scope !== "this";

	const openCustomRepeat = () =>
		setCustomRule(
			readCustomRecurrence(draft.repeat, draft.date) ??
				defaultCustomRecurrence(draft.date),
		);

	const commitCustomRepeat = () => {
		if (!customRule) return;
		setDraft({
			...draft,
			repeat: formatCustomRecurrence(customRule, draft.date, draft.startTime),
		});
		setCustomRule(null);
	};

	/**
	 * Typing is the create path here, so the sentence and its reading are the
	 * first step rather than a field above a folded form. What the sentence did
	 * not say the rest of the walk asks for.
	 */
	const editorFlow = (): ReactNode => {
		if (panel.kind === "none") return null;

		/**
		 * A custom rule is a decision inside the walk, so it is a step of the same
		 * walk. Stacking a sheet on a page that already fills the screen is the
		 * pattern this surface got rid of.
		 */
		if (customRule)
			return (
				<FlowScreen
					anchor="container"
					title="Custom recurrence"
					subtitle={formatDayLabel(draft.date)}
					steps={["Custom recurrence"]}
					activeStep={0}
					onBack={() => setCustomRule(null)}
					onExit={() => setCustomRule(null)}
					footer={
						<FooterNav
							onBack={() => setCustomRule(null)}
							nextLabel="Done"
							nextVariant="commit"
							onNext={commitCustomRepeat}
						/>
					}
				>
					<CustomRecurrenceEditor
						value={customRule}
						onChange={setCustomRule}
						date={draft.date}
						suggestedEndDate={defaultEndDate(draft.date)}
						touch
					/>
				</FlowScreen>
			);

		if (panel.kind === "scope") {
			const event = events.find((candidate) => candidate.id === panel.eventId);
			if (!event) return null;
			return (
				<FlowScreen
					anchor="container"
					title="Repeating event"
					subtitle={event.title}
					steps={SCOPED_EDIT_STEPS}
					activeStep={0}
					onBack={dismiss}
					onExit={dismiss}
				>
					<RecurrenceScopePrompt
						title={event.title}
						ruleText={event.recurrenceRule}
						instanceText={formatDayLabel(event.start.slice(0, 10))}
						onChoose={(scope) => applyScope(event.id, scope)}
						onCancel={dismiss}
						touch
					/>
				</FlowScreen>
			);
		}

		if (panel.kind === "edit") {
			const scoped = panel.scope !== "";
			const edited = events.find((candidate) => candidate.id === panel.eventId);
			return (
				<FlowScreen
					anchor="container"
					title="Edit event"
					subtitle={edited?.title ?? ""}
					steps={scoped ? SCOPED_EDIT_STEPS : ONE_OFF_EDIT_STEPS}
					activeStep={scoped ? 1 : 0}
					onBack={() =>
						scoped
							? setPanel({ kind: "scope", eventId: panel.eventId })
							: dismiss()
					}
					onExit={dismiss}
					footer={
						<FooterNav
							onBack={dismiss}
							nextLabel="Save"
							nextVariant="commit"
							onNext={commit}
						/>
					}
				>
					<EventEditPage
						draft={draft}
						onChange={setDraft}
						calendars={calendars}
						repeatEditable={repeatEditable}
						onCustomRepeat={openCustomRepeat}
					/>
				</FlowScreen>
			);
		}

		const last = step === EVENT_WIZARD_LAST_STEP;
		return (
			<FlowScreen
				anchor="container"
				title="New event"
				subtitle={formatDayLabel(draft.date)}
				steps={EVENT_WIZARD_STEPS}
				activeStep={step}
				onBack={() => (step === 0 ? dismiss() : setStep(step - 1))}
				onExit={dismiss}
				footer={
					<FooterNav
						onBack={() => (step === 0 ? dismiss() : setStep(step - 1))}
						nextLabel={last ? "Add" : "Continue"}
						nextVariant={last ? "commit" : "primary"}
						onNext={() => (last ? commit() : setStep(step + 1))}
					/>
				}
			>
				<EventWizardStep
					step={step}
					draft={draft}
					onChange={setDraft}
					calendars={calendars}
					repeatEditable={repeatEditable}
					onCustomRepeat={openCustomRepeat}
					phrase={
						<div className="flex flex-col gap-2">
							<AgendaPhraseField
								phrase={phrase}
								onPhraseChange={typePhrase}
								onOpen={() => undefined}
								onCommit={commit}
								touch
							/>
							{phrase.trim() !== "" && (
								<PhraseReading
									parse={parse}
									picks={picks}
									onPick={answerChoice}
									touch
								/>
							)}
						</div>
					}
				/>
			</FlowScreen>
		);
	};

	const phoneFlow = (): ReactNode => {
		if (flow === "editor") return editorFlow();

		if (flow === "attendee" && openedGuest)
			return (
				<FlowScreen
					anchor="container"
					title={openedGuest.name}
					subtitle={openedGuest.email}
					steps={["Guest"]}
					activeStep={0}
					onBack={closeGuest}
					onExit={closeGuest}
				>
					<AttendeeContextCard
						attendee={openedGuest}
						className="w-full border-0 p-0"
					/>
				</FlowScreen>
			);

		/** A guest who is no longer on the event leaves the event itself open. */
		if ((flow === "event" || flow === "attendee") && selectedEvent) {
			const calendar =
				calendarsById.get(selectedEvent.calendarId) ?? calendars[0];
			return (
				<FlowScreen
					anchor="container"
					title="Event"
					subtitle={`${calendar.name} · ${calendar.accountLabel}`}
					steps={["Event"]}
					activeStep={0}
					onBack={() => setFlow("none")}
					onExit={() => setFlow("none")}
					footer={
						<div className="flex items-center gap-3">
							<Button
								variant="ghost"
								size="md"
								icon={<Trash2 className="size-4" />}
								onClick={() => deleteSelected(selectedEvent)}
								className="min-h-11 shrink-0 text-danger"
							>
								Delete
							</Button>
							<Button
								variant="primary"
								size="md"
								onClick={() => startEdit(selectedEvent)}
								className="min-h-11 flex-1"
							>
								Edit
							</Button>
						</div>
					}
				>
					<EventDetail
						chrome="bare"
						event={selectedEvent}
						calendar={calendar}
						whenText={formatEventWhen(selectedEvent)}
						onEdit={() => startEdit(selectedEvent)}
						onDelete={() => deleteSelected(selectedEvent)}
						onOpenThread={
							selectedEvent.threadId === ""
								? undefined
								: () => openThread(selectedEvent.threadId)
						}
						activeAttendee={activeAttendee}
						onActivateAttendee={openGuest}
						touch
					/>
				</FlowScreen>
			);
		}

		if (flow === "thread")
			return (
				<FlowScreen
					anchor="container"
					bodyFit="fill"
					title={openedThread ? openedThread.subject : "Thread"}
					steps={["Thread"]}
					activeStep={0}
					onBack={closeThread}
					onExit={() => {
						setOpenThreadId("");
						setFlow("none");
					}}
				>
					{openedThread ? (
						<ReadingPane thread={openedThread} />
					) : (
						<ThreadGone />
					)}
				</FlowScreen>
			);

		if (flow === "calendars")
			return (
				<FlowScreen
					anchor="container"
					title="Calendars"
					subtitle="What the strip draws"
					steps={["Calendars"]}
					activeStep={0}
					onBack={() => setFlow("none")}
					onExit={() => setFlow("none")}
					footer={
						<Button
							variant="primary"
							size="md"
							onClick={() => setFlow("none")}
							className="min-h-11 w-full"
						>
							Done
						</Button>
					}
				>
					<CalendarList
						calendars={calendars}
						visible={visible}
						onToggle={toggleCalendar}
						onToggleAccount={toggleAccount}
						touch
					/>
				</FlowScreen>
			);

		if (flow === "suggestions")
			return (
				<FlowScreen
					anchor="container"
					title="Waiting for you"
					subtitle="None of it is on your calendar"
					steps={["Waiting for you"]}
					activeStep={0}
					onBack={() => setFlow("none")}
					onExit={() => setFlow("none")}
					footer={
						<Button
							variant="primary"
							size="md"
							onClick={() => setFlow("none")}
							className="min-h-11 w-full"
						>
							Done
						</Button>
					}
				>
					{suggestionColumn(true)}
				</FlowScreen>
			);

		return null;
	};

	if (isPhone)
		return (
			<MailShell
				width={width}
				selectedNavId="calendar"
				calendarNav="shown"
				list={
					<PhoneSurface
						title={monthLabel(visibleDate)}
						onToday={() => goTo(TODAY)}
						suggestionCount={visibleSuggestions.length}
						onOpenSuggestions={() => setFlow("suggestions")}
						visible={visible}
						onToggleCalendar={toggleCalendar}
						onOpenCalendars={() => setFlow("calendars")}
						view={view}
						onChangeView={changeView}
						density={density}
						onChangeDensity={setDensity}
						body={view === "agenda" ? strip : grid}
						onCompose={() => {
							setPhrase("");
							setPicks({});
							setExpanded(false);
							setDraft({ ...emptyDraft(), date: focusDate });
							setPanel({ kind: "create" });
							setStep(0);
							setFlow("editor");
						}}
					/>
				}
				overlay={phoneFlow()}
			/>
		);

	return (
		<MailShell
			width={width}
			selectedNavId="calendar"
			calendarNav="shown"
			list={
				<DesktopSurface
					title={headerTitle(view, visibleDate, focusDate)}
					onPrev={() =>
						goTo(
							view === "agenda"
								? addDays(focusDate, -7)
								: shiftDate(focusDate, view, -1),
						)
					}
					onNext={() =>
						goTo(
							view === "agenda"
								? addDays(focusDate, 7)
								: shiftDate(focusDate, view, 1),
						)
					}
					onToday={() => goTo(TODAY)}
					view={view}
					onChangeView={changeView}
					density={density}
					onChangeDensity={setDensity}
					visible={visible}
					onToggleCalendar={toggleCalendar}
					onToggleAccount={toggleAccount}
					positionMap={
						<PositionMap
							anchorDate={visibleDate}
							visibleDate={visibleDate}
							today={TODAY}
							dayOf={dayOf}
							onGoTo={goTo}
						/>
					}
					composer={
						<>
							{composer(false)}
							{customRule && (
								<CustomRecurrenceDialog
									open
									value={customRule}
									onChange={setCustomRule}
									date={draft.date}
									suggestedEndDate={defaultEndDate(draft.date)}
									onCancel={() => setCustomRule(null)}
									onDone={commitCustomRepeat}
								/>
							)}
						</>
					}
					body={view === "agenda" ? strip : grid}
					context={
						<>
							<NextUpCard
								nextUp={nextUp}
								calendars={calendars}
								today={TODAY}
								onSelectEvent={openEvent}
								onGoTo={goTo}
							/>
							<FreeTimeList
								stretches={openTime}
								today={TODAY}
								onPick={openFree}
							/>
							{suggestionColumn(false)}
						</>
					}
				/>
			}
			readingPane={openThreadId !== "" || selectedEvent ? "default" : "off"}
			reading={
				openThreadId !== "" ? (
					<ThreadPane
						thread={openedThread}
						backLabel={
							selectedEvent ? "Back to the event" : "Back to the strip"
						}
						onBack={closeThread}
					/>
				) : (
					(detail(() => setSelected("")) ?? undefined)
				)
			}
		/>
	);
}

/** The mail an event came out of, opened in the pane the event was in. */
function ThreadPane({
	thread,
	backLabel,
	onBack,
}: {
	/** Absent when the mailbox no longer holds the thread the event names. */
	thread: ThreadData | undefined;
	backLabel: string;
	onBack: () => void;
}) {
	return (
		<div className="flex h-full w-full min-w-0 flex-col bg-canvas">
			<div className="flex h-pane-header shrink-0 items-center border-b border-line px-row-inset">
				<Button
					variant="ghost"
					size="sm"
					icon={<ArrowLeft className="size-3.5" />}
					onClick={onBack}
				>
					{backLabel}
				</Button>
			</div>
			<div className="min-h-0 flex-1">
				{thread ? <ReadingPane thread={thread} /> : <ThreadGone />}
			</div>
		</div>
	);
}

/**
 * The event kept the id of a thread the mailbox no longer has. Saying so where
 * the mail would have been is the whole point: a pane that renders nothing is
 * indistinguishable from a broken one, and the way back has to survive it.
 */
function ThreadGone() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 px-row-inset py-8 text-center">
			<MailX className="size-6 text-fg-subtle" />
			<p className="text-sm font-medium text-fg">
				That mail is not in this mailbox any more
			</p>
			<p className="max-w-sm text-xs text-fg-muted">
				It was filed, deleted, or lives on an account this reader no longer
				carries. The event itself is untouched.
			</p>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Desktop                                                             */
/* ------------------------------------------------------------------ */

function DesktopSurface({
	title,
	onPrev,
	onNext,
	onToday,
	view,
	onChangeView,
	density,
	onChangeDensity,
	visible,
	onToggleCalendar,
	onToggleAccount,
	positionMap,
	composer,
	body,
	context,
}: {
	title: string;
	onPrev: () => void;
	onNext: () => void;
	onToday: () => void;
	view: CalendarViewId;
	onChangeView: (view: CalendarViewId) => void;
	density: AgendaDensity;
	onChangeDensity: (density: AgendaDensity) => void;
	visible: ReadonlySet<string>;
	onToggleCalendar: (calendarId: string) => void;
	onToggleAccount: (accountId: string, nextVisible: boolean) => void;
	positionMap: ReactNode;
	composer: ReactNode;
	body: ReactNode;
	context: ReactNode;
}) {
	const [surfaceRef, surfaceWidth] = useContainerWidth(1100);
	const measured = surfaceWidth ?? 0;
	const hasRail = measured >= RAIL_MIN_WIDTH;
	const hasContext = measured >= CONTEXT_MIN_WIDTH;
	const rail = railShare(measured);

	const stripAndContext = (
		<>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<div className="shrink-0 border-b border-line px-row-inset py-2">
					{composer}
				</div>
				{body}
			</div>

			{hasContext && (
				<aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface-sunken px-row-inset py-3">
					{context}
				</aside>
			)}
		</>
	);

	return (
		<div
			ref={surfaceRef}
			className="relative flex h-full w-full flex-col bg-surface"
		>
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<CalendarDateNav
					title={title}
					onPrev={onPrev}
					onNext={onNext}
					onToday={onToday}
				>
					<CalendarViewSwitch value={view} onChange={onChangeView} />
					{view === "agenda" && (
						<AgendaDensityControl value={density} onChange={onChangeDensity} />
					)}
				</CalendarDateNav>
			</header>

			{!hasRail && (
				<div className="flex h-9 shrink-0 items-center border-b border-line">
					<CalendarList
						calendars={calendars}
						visible={visible}
						onToggle={onToggleCalendar}
						layout="strip"
					/>
				</div>
			)}

			{hasRail ? (
				<ResizablePanelGroup
					key={rail.tier}
					direction="horizontal"
					className="min-h-0 flex-1"
				>
					<ResizablePanel
						id="calendars"
						order={1}
						defaultSize={rail.size}
						minSize={rail.minSize}
						maxSize={rail.maxSize}
						className="min-w-0"
					>
						<aside className="flex h-full flex-col gap-4 overflow-y-auto bg-surface-sunken py-3">
							<CalendarList
								calendars={calendars}
								visible={visible}
								onToggle={onToggleCalendar}
								onToggleAccount={onToggleAccount}
							/>
							{positionMap}
						</aside>
					</ResizablePanel>
					<ResizableHandle />
					<ResizablePanel id="strip" order={2} className="min-w-0">
						<div className="flex h-full min-h-0">{stripAndContext}</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			) : (
				<div className="flex min-h-0 flex-1">{stripAndContext}</div>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Phone                                                               */
/* ------------------------------------------------------------------ */

function PhoneSurface({
	title,
	onToday,
	suggestionCount,
	onOpenSuggestions,
	visible,
	onToggleCalendar,
	onOpenCalendars,
	view,
	onChangeView,
	density,
	onChangeDensity,
	body,
	onCompose,
}: {
	title: string;
	onToday: () => void;
	suggestionCount: number;
	onOpenSuggestions: () => void;
	visible: ReadonlySet<string>;
	onToggleCalendar: (calendarId: string) => void;
	onOpenCalendars: () => void;
	view: CalendarViewId;
	onChangeView: (view: CalendarViewId) => void;
	density: AgendaDensity;
	onChangeDensity: (density: AgendaDensity) => void;
	body: ReactNode;
	onCompose: () => void;
}) {
	return (
		<div className="flex h-full w-full flex-col bg-surface">
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
					{title}
				</h1>
				<button
					type="button"
					onClick={onToday}
					className="flex min-h-9 items-center rounded-md border border-line px-2.5 text-xs font-medium text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					Today
				</button>
				<button
					type="button"
					onClick={onOpenSuggestions}
					className="flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-accent-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<Sparkles className="size-3.5" />
					{suggestionCount}
				</button>
			</header>

			{/* The chips are the legend and the quick filter; the whole list, with
			    its accounts, is a screen of its own rather than a drawer. */}
			<div className="flex shrink-0 items-center gap-1 border-b border-line py-2 pr-row-inset">
				<CalendarList
					calendars={calendars}
					visible={visible}
					onToggle={onToggleCalendar}
					layout="strip"
					touch
					className="min-w-0 flex-1"
				/>
				<button
					type="button"
					onClick={onOpenCalendars}
					aria-label="All calendars"
					className="flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-xs text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<SlidersHorizontal className="size-3.5" />
					All
				</button>
			</div>

			{body}

			<div className="flex shrink-0 flex-col gap-2 border-t border-line px-row-inset py-2">
				<button
					type="button"
					onClick={onCompose}
					className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 text-left text-sm text-fg-subtle outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<Wand2 className="size-4 shrink-0" />
					lunch with Jane friday 1pm
				</button>
				<div className="flex items-center gap-2">
					<CalendarViewSwitch
						value={view}
						onChange={onChangeView}
						views={["month", "week", "day", "agenda"]}
						touch
						className="min-w-0 flex-1"
					/>
					{view === "agenda" && (
						<AgendaDensityControl
							value={density}
							onChange={onChangeDensity}
							icons
							touch
						/>
					)}
				</div>
			</div>
		</div>
	);
}
