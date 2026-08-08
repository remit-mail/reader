/**
 * Option A — the calendar as a destination in the mail app.
 *
 * The nav gains a Calendar entry beside the daily brief; picking it fills the
 * list pane with the grid and the reading pane with whatever event is open, the
 * same slots Drafts and the Outbox use. Nothing about mail moves.
 *
 * The state lives here because the prototype has to be clicked: creating an
 * event really adds it, ticking a calendar off really removes its events, and
 * the scope question really gates the edit behind it.
 */
import {
	addMinutesToClock,
	BottomSheet,
	Button,
	type CalendarAttendee,
	type CalendarColorId,
	CalendarDateNav,
	CalendarDensityControl,
	type CalendarEventData,
	CalendarList,
	type CalendarViewId,
	CalendarViewSwitch,
	calendarColorClasses,
	cn,
	type Density,
	EventDetail,
	type EventDraft,
	EventEditor,
	EventQuickEntry,
	type EventSuggestion,
	EventSuggestionCard,
	type PhraseParse,
	parseEventPhrase,
	ReadingPane,
	type RecurrenceScope,
	RecurrenceScopePrompt,
	type ThreadData,
	useContainerWidth,
} from "@remit/ui";
import { ArrowLeft, CalendarDays, Plus, Sparkles } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { CalendarGrid, type SlotPick } from "../components/calendar-grid.js";
import {
	allCalendarIds,
	calendars,
	calendarsById,
	eventFromSuggestion,
	formatDayLabel,
	formatEventWhen,
	formatSuggestionWhen,
	HOME_ZONE,
	events as seedEvents,
	suggestions as seedSuggestions,
	TODAY,
	threadFor,
} from "../fixtures/calendar.js";
import { MailShell } from "./mail-shell.js";

/** Below this the surface has no room for a calendar rail beside the grid. */
const RAIL_MIN_WIDTH = 700;

const colorByCalendarId: Record<string, CalendarColorId> = Object.fromEntries(
	calendars.map((calendar) => [calendar.id, calendar.color]),
);

/** Wednesday 10 June 2026, 09:30 — the same fixed now as the mail fixtures. */
const NOW = new Date(2026, 5, 10, 9, 30);

/** June puts Amsterdam at UTC+2, and the whole fixture week is in June. */
const OFFSET = "+02:00";

/** Where an event lands when the sentence named no hour. */
const FALLBACK_START = "10:00";

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

/** An event with nothing on it yet — what a create starts from. */
function blankEvent(): CalendarEventData {
	return {
		id: "",
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
		status: "confirmed",
	};
}

/**
 * The guest field is a list of names, so a guest already on the event keeps the
 * whole record — the address that was invited, the reply that came back, who
 * organised it. Only a name that was not there before is a new person.
 */
function guestsFrom(
	names: string,
	known: CalendarAttendee[],
): CalendarAttendee[] {
	return names
		.split(",")
		.map((name) => name.trim())
		.filter((name) => name !== "")
		.map(
			(name) =>
				known.find((attendee) => attendee.name === name) ?? {
					name,
					email: `${name.toLowerCase().replace(/\s+/g, ".")}@example`,
					rsvp: "noReply" as const,
					role: "attendee" as const,
				},
		);
}

/**
 * The draft holds only the fields the editor shows. Everything else — the
 * thread the event came out of, the series it belongs to, the zone the mail
 * gave, what everyone answered — comes off the event being edited, so saving an
 * edit never quietly destroys what the form never asked about.
 */
function applyDraft(
	base: CalendarEventData,
	draft: EventDraft,
): CalendarEventData {
	return {
		...base,
		calendarId: draft.calendarId,
		title: draft.title === "" ? "(no title)" : draft.title,
		start: draft.allDay
			? draft.date
			: `${draft.date}T${draft.startTime}:00${OFFSET}`,
		end: draft.allDay
			? nextDay(draft.date)
			: `${draft.date}T${draft.endTime}:00${OFFSET}`,
		allDay: draft.allDay,
		location: draft.location,
		notes: draft.notes,
		attendees: guestsFrom(draft.guests, base.attendees),
		recurrenceRule: draft.repeat,
	};
}

function nextDay(date: string): string {
	const next = new Date(`${date}T00:00:00Z`);
	next.setUTCDate(next.getUTCDate() + 1);
	return next.toISOString().slice(0, 10);
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

/** What the popover is showing, if anything. */
type Panel =
	| { kind: "none" }
	| {
			kind: "create";
			draft: EventDraft;
			/** What the new event carries beyond the form — a suggestion's thread. */
			base: CalendarEventData;
			/** The suggestion this create answers, consumed when it is saved. */
			suggestionId: string;
	  }
	| {
			kind: "edit";
			eventId: string;
			draft: EventDraft;
			/** Empty for a one-off; otherwise the answer the scope question got. */
			scope: RecurrenceScope | "";
	  }
	| { kind: "scope"; eventId: string };

/** The sheets the phone surface puts up, one at a time. */
type Sheet =
	| "none"
	| "create"
	| "detail"
	| "calendars"
	| "suggestions"
	| "thread";

export interface CalendarDestinationProps {
	width?: number;
	view?: CalendarViewId;
	date?: string;
	density?: Density;
	/** The event open in the reading pane on mount. */
	selectedEventId?: string;
	/** Calendars already ticked off, so a story can start filtered. */
	hiddenCalendarIds?: string[];
	/** Opens the create popover on mount at this slot. */
	draftAt?: SlotPick;
	/** Seeds the quick-entry field and opens the create popover with it. */
	phrase?: string;
	/** Opens the scope question for this instance of a series. */
	scopeForEventId?: string;
	/** Opens the phone sheet a story is about. */
	sheet?: "none" | "create" | "detail" | "calendars" | "suggestions";
}

export function CalendarDestination({
	width = 1440,
	view: initialView = "week",
	date: initialDate = TODAY,
	density: initialDensity = "comfortable",
	selectedEventId = "",
	hiddenCalendarIds = [],
	draftAt,
	phrase: initialPhrase = "",
	scopeForEventId = "",
	sheet: initialSheet = "none",
}: CalendarDestinationProps) {
	const isPhone = width < 768;

	const [view, setView] = useState<CalendarViewId>(initialView);
	const [date, setDate] = useState(initialDate);
	const [density, setDensity] = useState<Density>(initialDensity);
	const [rangeTitle, setRangeTitle] = useState(formatDayLabel(initialDate));
	const [events, setEvents] = useState<CalendarEventData[]>(seedEvents);
	const [suggestions, setSuggestions] =
		useState<EventSuggestion[]>(seedSuggestions);
	const [selected, setSelected] = useState(selectedEventId);
	const [visible, setVisible] = useState(
		() =>
			new Set(allCalendarIds.filter((id) => !hiddenCalendarIds.includes(id))),
	);
	const [phrase, setPhrase] = useState(initialPhrase);
	const [expanded, setExpanded] = useState(false);
	const [sheet, setSheet] = useState<Sheet>(initialSheet);
	const [openThreadId, setOpenThreadId] = useState("");
	const minted = useRef(0);
	const [panel, setPanel] = useState<Panel>(() => {
		if (scopeForEventId !== "")
			return { kind: "scope", eventId: scopeForEventId };
		if (initialPhrase !== "") return createPanel(fromPhrase(initialPhrase));
		if (draftAt) return createPanel(draftFromSlot(draftAt));
		return { kind: "none" };
	});

	const shown = useMemo(
		() => events.filter((event) => visible.has(event.calendarId)),
		[events, visible],
	);
	const selectedEvent = events.find((event) => event.id === selected);

	const toggleCalendar = (calendarId: string) =>
		setVisible((prev) => {
			const next = new Set(prev);
			if (!next.delete(calendarId)) next.add(calendarId);
			return next;
		});

	const toggleAccount = (accountId: string, nextVisible: boolean) =>
		setVisible((prev) => {
			const next = new Set(prev);
			for (const calendar of calendars) {
				if (calendar.accountId !== accountId) continue;
				if (nextVisible) next.add(calendar.id);
				else next.delete(calendar.id);
			}
			return next;
		});

	const openSlot = (pick: SlotPick) => {
		setPhrase("");
		setExpanded(false);
		setPanel(createPanel(draftFromSlot(pick)));
		if (isPhone) setSheet("create");
	};

	/**
	 * A month on a phone is for choosing a day: a tap moves the agenda under the
	 * grid to that day. Creating stays on the button, which is where a thumb
	 * expects it and where a mis-tap costs nothing.
	 */
	const pickSlot = (pick: SlotPick) => {
		if (isPhone && view === "month") {
			setDate(pick.date);
			return;
		}
		openSlot(pick);
	};

	const openEvent = (eventId: string) => {
		setSelected(eventId);
		setOpenThreadId("");
		setPanel({ kind: "none" });
		if (isPhone) setSheet("detail");
	};

	const openThread = (threadId: string) => {
		setOpenThreadId(threadId);
		if (isPhone) setSheet("thread");
	};

	const startEdit = (event: CalendarEventData) => {
		if (event.seriesId !== "") {
			setPanel({ kind: "scope", eventId: event.id });
			if (isPhone) setSheet("create");
			return;
		}
		setExpanded(false);
		setPanel({
			kind: "edit",
			eventId: event.id,
			draft: draftFromEvent(event),
			scope: "",
		});
		if (isPhone) setSheet("create");
	};

	const applyScope = (eventId: string, scope: RecurrenceScope) => {
		const event = events.find((candidate) => candidate.id === eventId);
		if (!event) return;
		setExpanded(scope !== "this");
		setPanel({
			kind: "edit",
			eventId,
			scope,
			draft: {
				...draftFromEvent(event),
				repeat: scope === "this" ? "" : event.recurrenceRule,
			},
		});
	};

	const commit = () => {
		if (panel.kind === "create") {
			minted.current += 1;
			const id = `evt_new_${minted.current}`;
			setEvents((prev) => [
				...prev,
				applyDraft({ ...panel.base, id }, panel.draft),
			]);
			if (panel.suggestionId !== "")
				setSuggestions((prev) =>
					prev.filter((item) => item.id !== panel.suggestionId),
				);
			setSelected(id);
		}
		if (panel.kind === "edit") {
			const base = events.find((event) => event.id === panel.eventId);
			if (!base) return;
			/* "Just this one" takes the instance out of its series, which is what
			   makes the next edit of it stop asking. */
			const detached =
				panel.scope === "this" ? { ...base, seriesId: "" } : base;
			const edited = applyDraft(detached, panel.draft);
			setEvents((prev) =>
				prev.map((event) => (event.id === panel.eventId ? edited : event)),
			);
		}
		setPanel({ kind: "none" });
		setPhrase("");
		setSheet("none");
	};

	const dismissPanel = () => {
		setPanel({ kind: "none" });
		setPhrase("");
		setSheet("none");
	};

	const acceptSuggestion = (suggestion: EventSuggestion) => {
		const id = `evt_from_${suggestion.id}`;
		setEvents((prev) => [...prev, eventFromSuggestion(suggestion, id)]);
		setSuggestions((prev) => prev.filter((item) => item.id !== suggestion.id));
		setDate(suggestion.start.slice(0, 10));
		setSelected(id);
		setSheet("none");
	};

	/**
	 * The other way to say yes: correct the reading first. It carries the same
	 * thread and zone Add carries, and saving takes the card off the list — a
	 * suggestion is answered once, by whichever path answered it.
	 */
	const reviewSuggestion = (suggestion: EventSuggestion) => {
		setPanel({
			kind: "create",
			base: eventFromSuggestion(suggestion, ""),
			suggestionId: suggestion.id,
			draft: {
				...emptyDraft(),
				title: suggestion.title,
				date: suggestion.start.slice(0, 10),
				startTime: suggestion.allDay ? "" : suggestion.start.slice(11, 16),
				endTime: suggestion.allDay ? "" : suggestion.end.slice(11, 16),
				allDay: suggestion.allDay,
				location: suggestion.location,
				calendarId: suggestion.suggestedCalendarId,
			},
		});
		setExpanded(true);
		if (isPhone) setSheet("create");
	};

	const dismissSuggestion = (suggestionId: string) =>
		setSuggestions((prev) => prev.filter((item) => item.id !== suggestionId));

	const grid = (
		<CalendarGrid
			view={view}
			date={date}
			events={shown}
			colorByCalendarId={colorByCalendarId}
			density={density}
			selectedEventId={selected}
			onSelectEvent={openEvent}
			onPickSlot={pickSlot}
			onRangeChange={setRangeTitle}
		/>
	);

	const editorPanel = (touch: boolean): ReactNode => {
		if (panel.kind === "none") return null;
		if (panel.kind === "scope") {
			const event = events.find((candidate) => candidate.id === panel.eventId);
			if (!event) return null;
			return (
				<RecurrenceScopePrompt
					title={event.title}
					ruleText={event.recurrenceRule}
					instanceText={formatDayLabel(event.start.slice(0, 10))}
					onChoose={(scope) => applyScope(event.id, scope)}
					onCancel={dismissPanel}
					touch={touch}
				/>
			);
		}
		return (
			<EventEditor
				draft={panel.draft}
				onChange={(draft) => setPanel({ ...panel, draft })}
				calendars={calendars}
				expanded={expanded}
				onToggleExpanded={() => setExpanded((open) => !open)}
				onSave={commit}
				onCancel={dismissPanel}
				saveLabel={panel.kind === "edit" ? "Save" : "Add"}
				touch={touch}
				header={
					panel.kind === "create" ? (
						<EventQuickEntry
							value={phrase}
							onChange={(next) => {
								setPhrase(next);
								setPanel({ ...panel, draft: fromPhrase(next) });
							}}
							parse={readPhrase(phrase)}
							onCommit={commit}
							touch={touch}
						/>
					) : undefined
				}
			/>
		);
	};

	const suggestionColumn = (touch: boolean) => (
		<div className="flex flex-col gap-2">
			<h3 className="flex items-center gap-1.5 px-row-inset text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				<Sparkles className="size-3" />
				Waiting for you
			</h3>
			{suggestions.length === 0 ? (
				<p className="px-row-inset text-xs text-fg-subtle">
					Nothing unread in your mail looks like a date.
				</p>
			) : (
				<div className="flex flex-col gap-2 px-row-inset">
					{suggestions.map((suggestion) => (
						<EventSuggestionCard
							key={suggestion.id}
							suggestion={suggestion}
							whenText={formatSuggestionWhen(suggestion)}
							onAdd={() => acceptSuggestion(suggestion)}
							onReview={() => reviewSuggestion(suggestion)}
							onDismiss={() => dismissSuggestion(suggestion.id)}
							onOpenThread={() => openThread(suggestion.threadId)}
							touch={touch}
						/>
					))}
				</div>
			)}
		</div>
	);

	const openedThread = threadFor(openThreadId);

	if (isPhone) {
		return (
			<MailShell
				width={width}
				selectedNavId="calendar"
				calendarNav="shown"
				list={
					<PhoneSurface
						view={view}
						onChangeView={setView}
						date={date}
						rangeTitle={rangeTitle}
						onPrev={() => setDate(shiftDate(date, view, -1))}
						onNext={() => setDate(shiftDate(date, view, 1))}
						onToday={() => setDate(TODAY)}
						density={density}
						onChangeDensity={setDensity}
						grid={grid}
						events={shown}
						onSelectEvent={openEvent}
						suggestionCount={suggestions.length}
						onOpenSuggestions={() => setSheet("suggestions")}
						visible={visible}
						onToggleCalendar={toggleCalendar}
						onCreate={() =>
							openSlot({
								date,
								startTime: FALLBACK_START,
								endTime: addMinutesToClock(FALLBACK_START, 60),
								allDay: false,
							})
						}
					/>
				}
				overlay={
					<>
						<BottomSheet
							open={sheet === "create" && panel.kind !== "none"}
							onClose={dismissPanel}
						>
							<div className="max-h-[80dvh] overflow-y-auto px-4 pb-6 pt-2">
								{editorPanel(true)}
							</div>
						</BottomSheet>
						<BottomSheet
							open={sheet === "detail" && Boolean(selectedEvent)}
							onClose={() => setSheet("none")}
						>
							<div className="h-[70dvh]">
								{selectedEvent && (
									<EventDetail
										event={selectedEvent}
										calendar={
											calendarsById.get(selectedEvent.calendarId) ??
											calendars[0]
										}
										whenText={formatEventWhen(selectedEvent)}
										onEdit={() => startEdit(selectedEvent)}
										onDelete={() => {
											setEvents((prev) =>
												prev.filter((event) => event.id !== selectedEvent.id),
											);
											setSheet("none");
										}}
										onOpenThread={
											selectedEvent.threadId === ""
												? undefined
												: () => openThread(selectedEvent.threadId)
										}
										onClose={() => setSheet("none")}
									/>
								)}
							</div>
						</BottomSheet>
						<BottomSheet
							open={sheet === "suggestions"}
							onClose={() => setSheet("none")}
						>
							<div className="max-h-[70dvh] overflow-y-auto py-3">
								{suggestionColumn(true)}
							</div>
						</BottomSheet>
						<BottomSheet
							open={sheet === "thread" && Boolean(openedThread)}
							onClose={() => setSheet("none")}
						>
							<div className="h-[80dvh]">
								<ReadingPane thread={openedThread} />
							</div>
						</BottomSheet>
					</>
				}
			/>
		);
	}

	return (
		<MailShell
			width={width}
			selectedNavId="calendar"
			calendarNav="shown"
			list={
				<DesktopSurface
					rangeTitle={rangeTitle}
					onPrev={() => setDate(shiftDate(date, view, -1))}
					onNext={() => setDate(shiftDate(date, view, 1))}
					onToday={() => setDate(TODAY)}
					view={view}
					onChangeView={setView}
					density={density}
					onChangeDensity={setDensity}
					visible={visible}
					onToggleCalendar={toggleCalendar}
					onToggleAccount={toggleAccount}
					grid={grid}
					suggestions={suggestionColumn(false)}
					panel={editorPanel(false)}
					onDismissPanel={dismissPanel}
				/>
			}
			listBias="list"
			readingPane={openedThread || selectedEvent ? "default" : "off"}
			reading={
				openedThread ? (
					<ThreadPane
						thread={openedThread}
						backLabel={selectedEvent ? "Back to the event" : "Back to the grid"}
						onBack={() => setOpenThreadId("")}
					/>
				) : selectedEvent ? (
					<EventDetail
						event={selectedEvent}
						calendar={
							calendarsById.get(selectedEvent.calendarId) ?? calendars[0]
						}
						whenText={formatEventWhen(selectedEvent)}
						onEdit={() => startEdit(selectedEvent)}
						onDelete={() => {
							setEvents((prev) =>
								prev.filter((event) => event.id !== selectedEvent.id),
							);
							setSelected("");
						}}
						onOpenThread={
							selectedEvent.threadId === ""
								? undefined
								: () => openThread(selectedEvent.threadId)
						}
						onClose={() => setSelected("")}
					/>
				) : undefined
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
	thread: ThreadData;
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
				<ReadingPane thread={thread} />
			</div>
		</div>
	);
}

function createPanel(draft: EventDraft): Panel {
	return { kind: "create", draft, base: blankEvent(), suggestionId: "" };
}

/**
 * The reader's reading, plus the form's own fallbacks. The form has to put the
 * event somewhere, so a sentence with no hour lands at ten — and that is an
 * assumption like any other, said out loud beside the day and the length rather
 * than applied behind the reading.
 */
function readPhrase(phrase: string): PhraseParse {
	const parse = parseEventPhrase(phrase, NOW);
	if (parse.startTime !== "") return parse;
	return {
		...parse,
		startTime: FALLBACK_START,
		durationMinutes: parse.durationMinutes === 0 ? 60 : parse.durationMinutes,
		unresolved: parse.unresolved.filter((note) => note !== "No time given"),
		assumptions: [
			...parse.assumptions,
			`No time given — using ${FALLBACK_START}`,
			...(parse.durationMinutes === 0
				? ["No length given — using an hour"]
				: []),
		],
	};
}

function fromPhrase(phrase: string): EventDraft {
	const parse = readPhrase(phrase);
	return {
		...emptyDraft(),
		title: parse.title,
		date: parse.date,
		startTime: parse.startTime,
		endTime: addMinutesToClock(parse.startTime, parse.durationMinutes),
		guests: parse.attendees.join(", "),
	};
}

/* ------------------------------------------------------------------ */
/* Desktop                                                             */
/* ------------------------------------------------------------------ */

function DesktopSurface({
	rangeTitle,
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
	grid,
	suggestions,
	panel,
	onDismissPanel,
}: {
	rangeTitle: string;
	onPrev: () => void;
	onNext: () => void;
	onToday: () => void;
	view: CalendarViewId;
	onChangeView: (view: CalendarViewId) => void;
	density: Density;
	onChangeDensity: (density: Density) => void;
	visible: ReadonlySet<string>;
	onToggleCalendar: (calendarId: string) => void;
	onToggleAccount: (accountId: string, nextVisible: boolean) => void;
	grid: ReactNode;
	suggestions: ReactNode;
	panel: ReactNode;
	onDismissPanel: () => void;
}) {
	const [surfaceRef, surfaceWidth] = useContainerWidth(1100);
	const hasRail = (surfaceWidth ?? 0) >= RAIL_MIN_WIDTH;

	return (
		<div
			ref={surfaceRef}
			className="relative flex h-full w-full flex-col bg-surface"
		>
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<CalendarDateNav
					title={rangeTitle}
					onPrev={onPrev}
					onNext={onNext}
					onToday={onToday}
				>
					<CalendarViewSwitch value={view} onChange={onChangeView} />
					<CalendarDensityControl value={density} onChange={onChangeDensity} />
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

			<div className="flex min-h-0 flex-1">
				{hasRail && (
					<aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-surface-sunken py-3">
						<CalendarList
							calendars={calendars}
							visible={visible}
							onToggle={onToggleCalendar}
							onToggleAccount={onToggleAccount}
						/>
						{suggestions}
					</aside>
				)}
				<div className="min-h-0 min-w-0 flex-1">{grid}</div>
			</div>

			{panel && (
				<>
					<button
						type="button"
						aria-label="Close editor"
						onClick={onDismissPanel}
						className="absolute inset-0 z-10 cursor-default bg-canvas/20"
					/>
					<div className="absolute left-1/2 top-14 z-20 w-80 -translate-x-1/2 rounded-lg border border-line bg-surface-raised p-4 shadow-xl shadow-black/25">
						{panel}
					</div>
				</>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Phone                                                               */
/* ------------------------------------------------------------------ */

function PhoneSurface({
	view,
	onChangeView,
	date,
	rangeTitle,
	onPrev,
	onNext,
	onToday,
	density,
	onChangeDensity,
	grid,
	events,
	onSelectEvent,
	suggestionCount,
	onOpenSuggestions,
	visible,
	onToggleCalendar,
	onCreate,
}: {
	view: CalendarViewId;
	onChangeView: (view: CalendarViewId) => void;
	date: string;
	rangeTitle: string;
	onPrev: () => void;
	onNext: () => void;
	onToday: () => void;
	density: Density;
	onChangeDensity: (density: Density) => void;
	grid: ReactNode;
	events: CalendarEventData[];
	onSelectEvent: (eventId: string) => void;
	suggestionCount: number;
	onOpenSuggestions: () => void;
	visible: ReadonlySet<string>;
	onToggleCalendar: (calendarId: string) => void;
	onCreate: () => void;
}) {
	const dayEvents = events
		.filter((event) =>
			event.allDay
				? date >= event.start.slice(0, 10) && date < event.end.slice(0, 10)
				: event.start.slice(0, 10) === date,
		)
		.sort((a, b) => a.start.localeCompare(b.start));

	return (
		<div className="relative flex h-full w-full flex-col bg-surface">
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<CalendarDays className="size-4 shrink-0 text-fg-subtle" />
				<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
					{rangeTitle}
				</h1>
				<button
					type="button"
					onClick={onOpenSuggestions}
					className="flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-accent-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<Sparkles className="size-3.5" />
					{suggestionCount}
				</button>
			</header>

			<div className="flex shrink-0 items-center gap-2 border-b border-line px-row-inset py-2">
				<CalendarDateNav
					title=""
					onPrev={onPrev}
					onNext={onNext}
					onToday={onToday}
					touch
				/>
			</div>

			<div className="shrink-0 border-b border-line py-2">
				<CalendarList
					calendars={calendars}
					visible={visible}
					onToggle={onToggleCalendar}
					layout="strip"
					touch
				/>
			</div>

			{/* The compact grid keeps the shape of the day — where the gaps are —
			    without asking a thumb to hit a 15-minute block. */}
			<div className="h-44 shrink-0 border-b border-line">{grid}</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{/* Which day the agenda is showing, because at this magnification the
				    header above names a month and a tap on the grid moves this. */}
				{view !== "day" && (
					<h2 className="sticky top-0 z-10 flex h-section-row items-center border-b border-line bg-surface-sunken px-row-inset text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
						{formatDayLabel(date)}
					</h2>
				)}
				{dayEvents.length === 0 ? (
					<p className="p-8 text-center text-sm text-fg-muted">
						Nothing on {formatDayLabel(date)}.
					</p>
				) : (
					dayEvents.map((event) => (
						<AgendaRow
							key={event.id}
							event={event}
							onSelect={() => onSelectEvent(event.id)}
						/>
					))
				)}
			</div>

			<div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-row-inset py-2">
				<CalendarViewSwitch
					value={view}
					onChange={onChangeView}
					views={["day", "week", "month"]}
					touch
					className="flex-1"
				/>
				<CalendarDensityControl
					value={density}
					onChange={onChangeDensity}
					touch
				/>
			</div>

			<Button
				variant="primary"
				onClick={onCreate}
				icon={<Plus className="size-5" />}
				aria-label="New event"
				className="absolute bottom-20 right-4 size-14 rounded-full shadow-lg shadow-black/25"
			/>
		</div>
	);
}

function AgendaRow({
	event,
	onSelect,
}: {
	event: CalendarEventData;
	onSelect: () => void;
}) {
	const calendar = calendarsById.get(event.calendarId);
	const hue = calendarColorClasses(calendar?.color ?? "cal-1");
	return (
		<button
			type="button"
			onClick={onSelect}
			className="flex min-h-14 w-full items-start gap-3 border-b border-line px-row-inset py-2 text-left outline-none active:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-ring"
		>
			<span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-fg-subtle">
				{event.allDay ? "All day" : event.start.slice(11, 16)}
			</span>
			<span className={cn("mt-1 h-8 w-1 shrink-0 rounded-full", hue.solid)} />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium text-fg">
					{event.title}
				</span>
				<span className="block truncate text-xs text-fg-subtle">
					{[calendar?.name, event.location].filter(Boolean).join(" · ")}
				</span>
			</span>
		</button>
	);
}
