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
	Button,
	type CalendarColorId,
	CalendarDateNav,
	type CalendarEventData,
	CalendarGrid,
	CalendarList,
	type CalendarSlotPick,
	type CalendarViewId,
	CalendarViewSwitch,
	type CustomRecurrence,
	CustomRecurrenceDialog,
	CustomRecurrenceEditor,
	calendarColorClasses,
	cn,
	defaultCustomRecurrence,
	defaultEndDate,
	EventDetail,
	type EventDraft,
	EventEditor,
	EventEditorPane,
	EventQuickEntry,
	type EventSuggestion,
	EventSuggestionCard,
	FlowScreen,
	FooterNav,
	formatCustomRecurrence,
	type PhraseParse,
	parseEventPhrase,
	ReadingPane,
	type RecurrenceScope,
	RecurrenceScopePrompt,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
	readCustomRecurrence,
	type ThreadData,
	useContainerWidth,
} from "@remit/ui";
import {
	ArrowLeft,
	CalendarDays,
	Plus,
	SlidersHorizontal,
	Sparkles,
	Trash2,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import {
	EVENT_WIZARD_LAST_STEP,
	EVENT_WIZARD_STEPS,
	EventEditPage,
	EventWizardStep,
	ONE_OFF_EDIT_STEPS,
	SCOPED_EDIT_STEPS,
} from "../components/event-wizard.js";
import {
	allCalendarIds,
	calendars,
	calendarsById,
	eventFromSuggestion,
	formatDayLabel,
	formatEventWhen,
	formatSuggestionWhen,
	HOME_ZONE,
	NOW_ISO,
	events as seedEvents,
	suggestions as seedSuggestions,
	TODAY,
	threadFor,
} from "../fixtures/calendar.js";
import { applyDraft, applyScopedEdit } from "../lib/calendar-edit.js";
import { railShare } from "../lib/calendar-rail.js";
import { MailShell } from "./mail-shell.js";

/** Below this the surface has no room for a calendar rail beside the grid. */
const RAIL_MIN_WIDTH = 700;

/**
 * Above this there is enough shell to give the form the wider half while the
 * grid stays readable, so the editing pane takes it and hands it back on save.
 */
const WIDE_WIDTH = 1280;

const colorByCalendarId: Record<string, CalendarColorId> = Object.fromEntries(
	calendars.map((calendar) => [calendar.id, calendar.color]),
);

/** Wednesday 10 June 2026, 09:30 — the same fixed now as the mail fixtures. */
const NOW = new Date(2026, 5, 10, 9, 30);

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

function draftFromSlot(pick: CalendarSlotPick): EventDraft {
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
		seriesException: false,
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

/** What the editor is working on, if anything. */
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

/** The full-screen flows the phone surface puts up, one at a time. */
type Flow =
	| "none"
	| "editor"
	| "event"
	| "calendars"
	| "suggestions"
	| "thread";

export interface CalendarDestinationProps {
	width?: number;
	view?: CalendarViewId;
	date?: string;
	/** The event open in the reading pane on mount. */
	selectedEventId?: string;
	/** Calendars already ticked off, so a story can start filtered. */
	hiddenCalendarIds?: string[];
	/** Opens the editor on mount at this slot. */
	draftAt?: CalendarSlotPick;
	/** Seeds the quick-entry field and opens the editor with it. */
	phrase?: string;
	/** Opens the scope question for this instance of a series. */
	scopeForEventId?: string;
	/** Opens the phone flow a story is about. */
	flow?: "none" | "editor" | "event" | "calendars" | "suggestions";
	/** Which step of the create walk the flow opens on. */
	step?: number;
	/** Opens the custom-rule editor over the form it belongs to. */
	customRepeat?: "closed" | "open";
}

export function CalendarDestination({
	width = 1440,
	view: initialView = "week",
	date: initialDate = TODAY,
	selectedEventId = "",
	hiddenCalendarIds = [],
	draftAt,
	phrase: initialPhrase = "",
	scopeForEventId = "",
	flow: initialFlow = "none",
	step: initialStep = 0,
	customRepeat = "closed",
}: CalendarDestinationProps) {
	const isPhone = width < 768;

	const [view, setView] = useState<CalendarViewId>(initialView);
	const [date, setDate] = useState(initialDate);
	const [rangeTitle, setRangeTitle] = useState(formatDayLabel(initialDate));
	const [events, setEvents] = useState<CalendarEventData[]>(seedEvents);
	const [suggestions, setSuggestions] =
		useState<EventSuggestion[]>(seedSuggestions);
	const [zones, setZones] = useState<Record<string, string>>({});
	const [selected, setSelected] = useState(selectedEventId);
	const [visible, setVisible] = useState(
		() =>
			new Set(allCalendarIds.filter((id) => !hiddenCalendarIds.includes(id))),
	);
	const [phrase, setPhrase] = useState(initialPhrase);
	const [flow, setFlow] = useState<Flow>(initialFlow);
	const [step, setStep] = useState(initialStep);
	const [customRule, setCustomRule] = useState<CustomRecurrence | null>(() =>
		customRepeat === "open"
			? defaultCustomRecurrence(draftAt?.date ?? initialDate)
			: null,
	);
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

	const openSlot = (pick: CalendarSlotPick) => {
		setPhrase("");
		setPanel(createPanel(draftFromSlot(pick)));
		setStep(0);
		if (isPhone) setFlow("editor");
	};

	/**
	 * A month on a phone is for choosing a day: a tap moves the agenda under the
	 * grid to that day. Creating stays on the button, which is where a thumb
	 * expects it and where a mis-tap costs nothing.
	 */
	const pickSlot = (pick: CalendarSlotPick) => {
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
		if (isPhone) setFlow("event");
	};

	const openThread = (threadId: string) => {
		setOpenThreadId(threadId);
		if (isPhone) setFlow("thread");
	};

	const startEdit = (event: CalendarEventData) => {
		if (event.seriesId !== "") {
			setPanel({ kind: "scope", eventId: event.id });
			if (isPhone) setFlow("editor");
			return;
		}
		setPanel({
			kind: "edit",
			eventId: event.id,
			draft: draftFromEvent(event),
			scope: "",
		});
		if (isPhone) setFlow("editor");
	};

	const applyScope = (eventId: string, scope: RecurrenceScope) => {
		const event = events.find((candidate) => candidate.id === eventId);
		if (!event) return;
		setPanel({ kind: "edit", eventId, scope, draft: draftFromEvent(event) });
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
		if (panel.kind === "edit")
			setEvents((prev) =>
				applyScopedEdit(prev, panel.eventId, panel.draft, panel.scope),
			);
		setPanel({ kind: "none" });
		setPhrase("");
		setStep(0);
		setFlow("none");
	};

	const dismissPanel = () => {
		setPanel({ kind: "none" });
		setPhrase("");
		setStep(0);
		setFlow("none");
	};

	const acceptSuggestion = (suggestion: EventSuggestion, timeZone: string) => {
		const id = `evt_from_${suggestion.id}`;
		const promoted = eventFromSuggestion(suggestion, id, timeZone);
		setEvents((prev) => [...prev, promoted]);
		setSuggestions((prev) => prev.filter((item) => item.id !== suggestion.id));
		setDate(promoted.start.slice(0, 10));
		setSelected(id);
		setFlow("none");
	};

	/**
	 * The other way to say yes: correct the reading first. It carries the same
	 * thread and zone Add carries, and saving takes the card off the list — a
	 * suggestion is answered once, by whichever path answered it.
	 */
	const reviewSuggestion = (suggestion: EventSuggestion, timeZone: string) => {
		const base = eventFromSuggestion(suggestion, "", timeZone);
		setPanel({
			kind: "create",
			base,
			suggestionId: suggestion.id,
			draft: {
				...emptyDraft(),
				title: base.title,
				date: base.start.slice(0, 10),
				startTime: base.allDay ? "" : base.start.slice(11, 16),
				endTime: base.allDay ? "" : base.end.slice(11, 16),
				allDay: base.allDay,
				location: base.location,
				calendarId: base.calendarId,
			},
		});
		setStep(0);
		if (isPhone) setFlow("editor");
	};

	const dismissSuggestion = (suggestionId: string) =>
		setSuggestions((prev) => prev.filter((item) => item.id !== suggestionId));

	const grid = (
		<CalendarGrid
			view={view}
			date={date}
			events={shown}
			colorByCalendarId={colorByCalendarId}
			density="comfortable"
			selectedEventId={selected}
			timeZone={HOME_ZONE}
			now={NOW_ISO}
			onSelectEvent={openEvent}
			onPickSlot={pickSlot}
			onRangeChange={setRangeTitle}
		/>
	);

	const panelEvent =
		panel.kind === "none" || panel.kind === "create"
			? undefined
			: events.find((candidate) => candidate.id === panel.eventId);

	const repeatEditable = panel.kind !== "edit" || panel.scope !== "this";

	/** The draft the editor is on, whichever way the editor was opened. */
	const editedDraft =
		panel.kind === "create" || panel.kind === "edit" ? panel.draft : undefined;

	const openCustomRepeat = () => {
		if (!editedDraft) return;
		setCustomRule(
			readCustomRecurrence(editedDraft.repeat, editedDraft.date) ??
				defaultCustomRecurrence(editedDraft.date),
		);
	};

	const commitCustomRepeat = () => {
		if (!customRule || !editedDraft) return;
		setPanel({
			...(panel as Extract<Panel, { kind: "create" | "edit" }>),
			draft: {
				...editedDraft,
				repeat: formatCustomRecurrence(
					customRule,
					editedDraft.date,
					editedDraft.startTime,
				),
			},
		});
		setCustomRule(null);
	};

	const quickEntry = (touch: boolean): ReactNode =>
		panel.kind !== "create" ? undefined : (
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
		);

	const editorForm = (): ReactNode => {
		if (panel.kind === "none") return null;
		if (panel.kind === "scope") {
			if (!panelEvent) return null;
			return (
				<RecurrenceScopePrompt
					title={panelEvent.title}
					ruleText={panelEvent.recurrenceRule}
					instanceText={formatDayLabel(panelEvent.start.slice(0, 10))}
					onChoose={(scope) => applyScope(panelEvent.id, scope)}
					onCancel={dismissPanel}
				/>
			);
		}
		return (
			<EventEditor
				draft={panel.draft}
				onChange={(draft) => setPanel({ ...panel, draft })}
				calendars={calendars}
				layout="pane"
				onSave={commit}
				onCancel={dismissPanel}
				saveLabel={panel.kind === "edit" ? "Save" : "Add"}
				repeatEditable={repeatEditable}
				guestsEditable
				onCustomRepeat={openCustomRepeat}
				header={quickEntry(false)}
			/>
		);
	};

	/**
	 * One editing surface on desktop, and it is the pane the event is read in.
	 * The scope question is asked in it too, so the answer and the edit it gates
	 * arrive in the same place rather than one over the grid and one beside it.
	 */
	const editorPane = (): ReactNode => {
		if (panel.kind === "none") return null;
		const title =
			panel.kind === "create"
				? "New event"
				: panel.kind === "scope"
					? "Repeating event"
					: "Edit event";
		const subtitle =
			panel.kind === "create"
				? formatDayLabel(panel.draft.date)
				: (panelEvent?.title ?? "");
		return (
			<EventEditorPane title={title} subtitle={subtitle} onClose={dismissPanel}>
				{editorForm()}
				{customRule && editedDraft && (
					<CustomRecurrenceDialog
						open
						value={customRule}
						onChange={setCustomRule}
						date={editedDraft.date}
						suggestedEndDate={defaultEndDate(editedDraft.date)}
						onCancel={() => setCustomRule(null)}
						onDone={commitCustomRepeat}
					/>
				)}
			</EventEditorPane>
		);
	};

	const suggestionColumn = (touch: boolean, inset = "px-row-inset") => (
		<div className="flex flex-col gap-2">
			<h3
				className={cn(
					"flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-subtle",
					inset,
				)}
			>
				<Sparkles className="size-3" />
				Waiting for you
			</h3>
			{suggestions.length === 0 ? (
				<p className={cn("text-xs text-fg-subtle", inset)}>
					Nothing unread in your mail looks like a date.
				</p>
			) : (
				<div className={cn("flex flex-col gap-2", inset)}>
					{suggestions.map((suggestion) => (
						<EventSuggestionCard
							key={suggestion.id}
							suggestion={suggestion}
							whenText={formatSuggestionWhen(suggestion)}
							zoneChoice={zones[suggestion.id] ?? ""}
							onZoneChoice={(timeZone) =>
								setZones((prev) => ({ ...prev, [suggestion.id]: timeZone }))
							}
							onAdd={(timeZone) => acceptSuggestion(suggestion, timeZone)}
							onReview={(timeZone) => reviewSuggestion(suggestion, timeZone)}
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
	const editing = panel.kind !== "none";

	/**
	 * Making an event on a phone is a walk: what, when, who, where it lands. A
	 * repeating event answers which instances first, because the answer changes
	 * what the edit means. Changing one that already exists is a single page —
	 * a title is one field and should not cost four screens.
	 */
	const editorFlow = (): ReactNode => {
		if (panel.kind === "none") return null;

		/**
		 * A custom rule is a decision inside the walk, so it is a step of the same
		 * walk. Stacking a sheet on a page that already fills the screen is the
		 * pattern this surface got rid of.
		 */
		if (customRule && editedDraft)
			return (
				<FlowScreen
					anchor="container"
					title="Custom recurrence"
					subtitle={formatDayLabel(editedDraft.date)}
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
						date={editedDraft.date}
						suggestedEndDate={defaultEndDate(editedDraft.date)}
						touch
					/>
				</FlowScreen>
			);

		if (panel.kind === "scope")
			return panelEvent ? (
				<FlowScreen
					anchor="container"
					title="Repeating event"
					subtitle={panelEvent.title}
					steps={SCOPED_EDIT_STEPS}
					activeStep={0}
					onBack={dismissPanel}
					onExit={dismissPanel}
				>
					<RecurrenceScopePrompt
						title={panelEvent.title}
						ruleText={panelEvent.recurrenceRule}
						instanceText={formatDayLabel(panelEvent.start.slice(0, 10))}
						onChoose={(scope) => applyScope(panelEvent.id, scope)}
						onCancel={dismissPanel}
						touch
					/>
				</FlowScreen>
			) : null;

		if (panel.kind === "edit") {
			const scoped = panel.scope !== "";
			return (
				<FlowScreen
					anchor="container"
					title="Edit event"
					subtitle={panelEvent?.title ?? ""}
					steps={scoped ? SCOPED_EDIT_STEPS : ONE_OFF_EDIT_STEPS}
					activeStep={scoped ? 1 : 0}
					onBack={() =>
						scoped
							? setPanel({ kind: "scope", eventId: panel.eventId })
							: dismissPanel()
					}
					onExit={dismissPanel}
					footer={
						<FooterNav
							onBack={dismissPanel}
							nextLabel="Save"
							nextVariant="commit"
							onNext={commit}
						/>
					}
				>
					<EventEditPage
						draft={panel.draft}
						onChange={(draft) => setPanel({ ...panel, draft })}
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
				subtitle={formatDayLabel(panel.draft.date)}
				steps={EVENT_WIZARD_STEPS}
				activeStep={step}
				onBack={() => (step === 0 ? dismissPanel() : setStep(step - 1))}
				onExit={dismissPanel}
				footer={
					<FooterNav
						onBack={() => (step === 0 ? dismissPanel() : setStep(step - 1))}
						nextLabel={last ? "Add" : "Continue"}
						nextVariant={last ? "commit" : "primary"}
						onNext={() => (last ? commit() : setStep(step + 1))}
					/>
				}
			>
				<EventWizardStep
					step={step}
					draft={panel.draft}
					onChange={(draft) => setPanel({ ...panel, draft })}
					calendars={calendars}
					repeatEditable={repeatEditable}
					onCustomRepeat={openCustomRepeat}
					phrase={quickEntry(true)}
				/>
			</FlowScreen>
		);
	};

	const phoneFlow = (): ReactNode => {
		if (flow === "editor") return editorFlow();

		if (flow === "event" && selectedEvent) {
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
								onClick={() => {
									setEvents((prev) =>
										prev.filter((event) => event.id !== selectedEvent.id),
									);
									setFlow("none");
								}}
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
						onDelete={() => undefined}
						onOpenThread={
							selectedEvent.threadId === ""
								? undefined
								: () => openThread(selectedEvent.threadId)
						}
					/>
				</FlowScreen>
			);
		}

		if (flow === "thread" && openedThread)
			return (
				<FlowScreen
					anchor="container"
					bodyFit="fill"
					title={openedThread.subject}
					steps={["Thread"]}
					activeStep={0}
					onBack={() => setFlow(selectedEvent ? "event" : "none")}
					onExit={() => setFlow("none")}
				>
					<ReadingPane thread={openedThread} />
				</FlowScreen>
			);

		if (flow === "calendars")
			return (
				<FlowScreen
					anchor="container"
					title="Calendars"
					subtitle="What the grid draws"
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
					{suggestionColumn(true, "")}
				</FlowScreen>
			);

		return null;
	};

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
						grid={grid}
						events={shown}
						onSelectEvent={openEvent}
						suggestionCount={suggestions.length}
						onOpenSuggestions={() => setFlow("suggestions")}
						visible={visible}
						onToggleCalendar={toggleCalendar}
						onOpenCalendars={() => setFlow("calendars")}
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
				overlay={phoneFlow()}
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
					visible={visible}
					onToggleCalendar={toggleCalendar}
					onToggleAccount={toggleAccount}
					grid={grid}
					suggestions={suggestionColumn(false)}
				/>
			}
			listBias={editing && width >= WIDE_WIDTH ? "balanced" : "list"}
			readingPane={editing || openedThread || selectedEvent ? "default" : "off"}
			reading={
				editing ? (
					editorPane()
				) : openedThread ? (
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
	visible,
	onToggleCalendar,
	onToggleAccount,
	grid,
	suggestions,
}: {
	rangeTitle: string;
	onPrev: () => void;
	onNext: () => void;
	onToday: () => void;
	view: CalendarViewId;
	onChangeView: (view: CalendarViewId) => void;
	visible: ReadonlySet<string>;
	onToggleCalendar: (calendarId: string) => void;
	onToggleAccount: (accountId: string, nextVisible: boolean) => void;
	grid: ReactNode;
	suggestions: ReactNode;
}) {
	const [surfaceRef, surfaceWidth] = useContainerWidth(1100);
	const hasRail = (surfaceWidth ?? 0) >= RAIL_MIN_WIDTH;
	const rail = railShare(surfaceWidth ?? 0);

	return (
		<div ref={surfaceRef} className="flex h-full w-full flex-col bg-surface">
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<CalendarDateNav
					title={rangeTitle}
					onPrev={onPrev}
					onNext={onNext}
					onToday={onToday}
				>
					<CalendarViewSwitch value={view} onChange={onChangeView} />
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
							{suggestions}
						</aside>
					</ResizablePanel>
					<ResizableHandle />
					<ResizablePanel id="grid" order={2} className="min-w-0">
						{grid}
					</ResizablePanel>
				</ResizablePanelGroup>
			) : (
				<div className="min-h-0 min-w-0 flex-1">{grid}</div>
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
	grid,
	events,
	onSelectEvent,
	suggestionCount,
	onOpenSuggestions,
	visible,
	onToggleCalendar,
	onOpenCalendars,
	onCreate,
}: {
	view: CalendarViewId;
	onChangeView: (view: CalendarViewId) => void;
	date: string;
	rangeTitle: string;
	onPrev: () => void;
	onNext: () => void;
	onToday: () => void;
	grid: ReactNode;
	events: CalendarEventData[];
	onSelectEvent: (eventId: string) => void;
	suggestionCount: number;
	onOpenSuggestions: () => void;
	visible: ReadonlySet<string>;
	onToggleCalendar: (calendarId: string) => void;
	onOpenCalendars: () => void;
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
