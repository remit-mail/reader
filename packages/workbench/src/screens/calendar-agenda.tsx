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
	BottomSheet,
	CalendarDateNav,
	CalendarDensityControl,
	type CalendarEventData,
	CalendarList,
	type CalendarViewId,
	CalendarViewSwitch,
	type Density,
	EventDetail,
	type EventDraft,
	type EventSuggestion,
	EventSuggestionCard,
	type RecurrenceScope,
	RecurrenceScopePrompt,
	useContainerWidth,
} from "@remit/ui";
import { Sparkles, Wand2 } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { AgendaComposer } from "../components/agenda-composer.js";
import {
	type AgendaDensity,
	AgendaFlow,
	type AgendaScrollTarget,
} from "../components/agenda-flow.js";
import {
	AgendaDensityControl,
	FreeTimeList,
	NextUpCard,
	PositionMap,
} from "../components/agenda-panels.js";
import { CalendarGrid, type SlotPick } from "../components/calendar-grid.js";
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
	suggestions as seedSuggestions,
	TODAY,
} from "../fixtures/calendar.js";
import {
	agendaEvents,
	STRIP_FIRST_DATE,
	STRIP_LAST_DATE,
} from "../fixtures/calendar-agenda.js";
import { type ChoicePicks, parseAgendaPhrase } from "../lib/agenda-phrase.js";
import {
	addDays,
	datesBetween,
	type FreeStretch,
	formatMinute,
	freeAhead,
	monthLabel,
	readNextUp,
} from "../lib/agenda-time.js";
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

function eventFromDraft(draft: EventDraft, id: string): CalendarEventData {
	const offset = "+02:00";
	return {
		id,
		calendarId: draft.calendarId,
		title: draft.title === "" ? "(no title)" : draft.title,
		start: draft.allDay
			? draft.date
			: `${draft.date}T${draft.startTime}:00${offset}`,
		end: draft.allDay
			? addDays(draft.date, 1)
			: `${draft.date}T${draft.endTime}:00${offset}`,
		allDay: draft.allDay,
		location: draft.location,
		notes: draft.notes,
		attendees: draft.guests
			.split(",")
			.map((name) => name.trim())
			.filter((name) => name !== "")
			.map((name) => ({
				name,
				email: `${name.toLowerCase().replace(/\s+/g, ".")}@example`,
				rsvp: "noReply" as const,
				role: "attendee" as const,
			})),
		myRsvp: "accepted",
		threadId: "",
		threadSubject: "",
		timeZone: HOME_ZONE,
		zoneCertainty: "local",
		recurrenceRule: draft.repeat,
		seriesId: draft.repeat === "" ? "" : `ser_${id}`,
		status: "confirmed",
	};
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

type Panel =
	| { kind: "none" }
	| { kind: "create" }
	| { kind: "edit"; eventId: string }
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
	/** Opens the phone sheet a story is about. */
	sheet?: "none" | "create" | "detail" | "suggestions";
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
	sheet: initialSheet = "none",
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
		useState<EventSuggestion[]>(seedSuggestions);
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
	const [sheet, setSheet] = useState(initialSheet);
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
		if (isPhone) setSheet("create");
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
		if (isPhone) setSheet("detail");
	};

	const startEdit = (event: CalendarEventData) => {
		if (event.seriesId !== "") {
			setPanel({ kind: "scope", eventId: event.id });
			if (isPhone) setSheet("create");
			return;
		}
		setPhrase("");
		setExpanded(false);
		setDraft(draftFromEvent(event));
		setPanel({ kind: "edit", eventId: event.id });
		if (isPhone) setSheet("create");
	};

	const applyScope = (eventId: string, scope: RecurrenceScope) => {
		const event = events.find((candidate) => candidate.id === eventId);
		if (!event) return;
		setExpanded(scope !== "this");
		setDraft({
			...draftFromEvent(event),
			repeat: scope === "this" ? "" : event.recurrenceRule,
		});
		setPanel({ kind: "edit", eventId });
	};

	const dismiss = () => {
		setPanel({ kind: "none" });
		setPhrase("");
		setPicks({});
		setSheet("none");
	};

	const commit = () => {
		if (panel.kind === "create") {
			const id = `evt_new_${events.length}`;
			setEvents((previous) => [...previous, eventFromDraft(draft, id)]);
			setSelected(id);
			goTo(draft.date);
		}
		if (panel.kind === "edit") {
			const edited = eventFromDraft(draft, panel.eventId);
			setEvents((previous) =>
				previous.map((event) => (event.id === panel.eventId ? edited : event)),
			);
		}
		dismiss();
	};

	const acceptSuggestion = (suggestion: EventSuggestion) => {
		const id = `evt_from_${suggestion.id}`;
		setEvents((previous) => [...previous, eventFromSuggestion(suggestion, id)]);
		setSuggestions((previous) =>
			previous.filter((item) => item.id !== suggestion.id),
		);
		setSelected(id);
		setSheet("none");
		goTo(suggestion.start.slice(0, 10));
	};

	const deleteSelected = (event: CalendarEventData) => {
		setEvents((previous) =>
			previous.filter((candidate) => candidate.id !== event.id),
		);
		setSelected("");
		setSheet("none");
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

	const flow = (
		<AgendaFlow
			days={days}
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
			lead={
				isPhone ? (
					<div className="border-b border-line p-3">
						<NextUpCard
							nextUp={nextUp}
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
				open={panel.kind !== "none"}
				onOpen={() => {
					if (panel.kind === "none") setPanel({ kind: "create" });
				}}
				touch={touch}
			/>
		);
	};

	const suggestionColumn = (touch: boolean) => (
		<section className="flex flex-col gap-2">
			<h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				<Sparkles className="size-3" />
				Waiting for you
			</h3>
			{suggestions.length === 0 ? (
				<p className="text-xs text-fg-subtle">
					Nothing unread in your mail looks like a date.
				</p>
			) : (
				suggestions.map((suggestion) => (
					<EventSuggestionCard
						key={suggestion.id}
						suggestion={suggestion}
						whenText={formatSuggestionWhen(suggestion)}
						onAdd={() => acceptSuggestion(suggestion)}
						onReview={() => goTo(suggestion.start.slice(0, 10))}
						onDismiss={() =>
							setSuggestions((previous) =>
								previous.filter((item) => item.id !== suggestion.id),
							)
						}
						onOpenThread={() => undefined}
						touch={touch}
					/>
				))
			)}
		</section>
	);

	const detail = (onClose: () => void) =>
		selectedEvent ? (
			<EventDetail
				event={selectedEvent}
				calendar={calendarsById.get(selectedEvent.calendarId) ?? calendars[0]}
				whenText={formatEventWhen(selectedEvent)}
				onEdit={() => startEdit(selectedEvent)}
				onDelete={() => deleteSelected(selectedEvent)}
				onOpenThread={
					selectedEvent.threadId === "" ? undefined : () => undefined
				}
				onClose={onClose}
			/>
		) : null;

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
						suggestionCount={suggestions.length}
						onOpenSuggestions={() => setSheet("suggestions")}
						visible={visible}
						onToggleCalendar={toggleCalendar}
						view={view}
						onChangeView={changeView}
						density={density}
						onChangeDensity={setDensity}
						gridDensity={gridDensity}
						onChangeGridDensity={(next) =>
							setDensity(next === "comfortable" ? "detail" : "pills")
						}
						body={view === "agenda" ? flow : grid}
						onCompose={() => {
							setPhrase("");
							setPicks({});
							setExpanded(false);
							setDraft({ ...emptyDraft(), date: focusDate });
							setPanel({ kind: "create" });
							setSheet("create");
						}}
					/>
				}
				overlay={
					<>
						<BottomSheet
							open={sheet === "create" && panel.kind !== "none"}
							onClose={dismiss}
						>
							<div className="max-h-[80dvh] overflow-y-auto px-4 pb-6 pt-2">
								{composer(true)}
							</div>
						</BottomSheet>
						<BottomSheet
							open={sheet === "detail" && Boolean(selectedEvent)}
							onClose={() => setSheet("none")}
						>
							<div className="h-[70dvh]">{detail(() => setSheet("none"))}</div>
						</BottomSheet>
						<BottomSheet
							open={sheet === "suggestions"}
							onClose={() => setSheet("none")}
						>
							<div className="max-h-[70dvh] overflow-y-auto p-4">
								{suggestionColumn(true)}
							</div>
						</BottomSheet>
					</>
				}
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
					gridDensity={gridDensity}
					onChangeGridDensity={(next) =>
						setDensity(next === "comfortable" ? "detail" : "pills")
					}
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
					composer={composer(false)}
					body={view === "agenda" ? flow : grid}
					context={
						<>
							<NextUpCard
								nextUp={nextUp}
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
			readingPane={selectedEvent ? "default" : "off"}
			reading={detail(() => setSelected("")) ?? undefined}
		/>
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
	gridDensity,
	onChangeGridDensity,
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
	gridDensity: Density;
	onChangeGridDensity: (density: Density) => void;
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
					{view === "agenda" ? (
						<AgendaDensityControl value={density} onChange={onChangeDensity} />
					) : (
						<CalendarDensityControl
							value={gridDensity}
							onChange={onChangeGridDensity}
						/>
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

			<div className="flex min-h-0 flex-1">
				{hasRail && (
					<aside className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-surface-sunken py-3">
						<CalendarList
							calendars={calendars}
							visible={visible}
							onToggle={onToggleCalendar}
							onToggleAccount={onToggleAccount}
						/>
						{positionMap}
					</aside>
				)}

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
			</div>
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
	view,
	onChangeView,
	density,
	onChangeDensity,
	gridDensity,
	onChangeGridDensity,
	body,
	onCompose,
}: {
	title: string;
	onToday: () => void;
	suggestionCount: number;
	onOpenSuggestions: () => void;
	visible: ReadonlySet<string>;
	onToggleCalendar: (calendarId: string) => void;
	view: CalendarViewId;
	onChangeView: (view: CalendarViewId) => void;
	density: AgendaDensity;
	onChangeDensity: (density: AgendaDensity) => void;
	gridDensity: Density;
	onChangeGridDensity: (density: Density) => void;
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

			<div className="shrink-0 border-b border-line py-2">
				<CalendarList
					calendars={calendars}
					visible={visible}
					onToggle={onToggleCalendar}
					layout="strip"
					touch
				/>
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
					{view === "agenda" ? (
						<AgendaDensityControl
							value={density}
							onChange={onChangeDensity}
							icons
							touch
						/>
					) : (
						<CalendarDensityControl
							value={gridDensity}
							onChange={onChangeGridDensity}
							touch
						/>
					)}
				</div>
			</div>
		</div>
	);
}
