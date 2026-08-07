import type { Meta, StoryObj } from "@storybook/react-vite";
import { densestDay, quietestDay } from "../fixtures/calendar.js";
import { PHONE_WIDTH, phoneFrame, phoneParams } from "../lib/story-frame.js";
import { CalendarDestination } from "../screens/calendar-destination.js";

/**
 * Option A puts the calendar where the daily brief already is: a destination in
 * the same nav, filling the same panes, leaving mail exactly as it was. It is
 * the conservative bet — what Google Calendar and Outlook are shaped like —
 * taken seriously rather than copied.
 *
 * What it commits to. Time is one strip and the views are magnifications of it,
 * so year, month, week and day keep the date you were looking at and Today
 * always lands on the same target. The calendar list is a control, not a
 * setting: it sits beside the grid at every width, as a column where there is
 * room and a row of chips where there is not, and unticking one takes its
 * events off the grid at once. Creating an event costs three fields and a
 * popover the grid stays visible behind. A sentence typed into the quick-entry
 * field is read live into those fields, with each reading attributed to the
 * words it came from and every assumption named, so the machine is corrected
 * before the event exists. Nothing arrives from mail on its own: what the
 * reader finds waits on a dashed card off the grid until someone answers it,
 * with Add or by correcting it first — either way it is answered once and the
 * card goes.
 *
 * The grid keeps the wider half of the split. A week is seven columns and a day
 * is a ruler; a list pane sized for a message list makes both unreadable, so
 * the shell is told which pane is the work rather than the calendar hiding the
 * detail pane to get room.
 *
 * On a phone it is a different design, not the same one squeezed. The grid
 * shrinks to a strip that shows the shape of the day, the events themselves
 * become a scrolling agenda under it, and the editor is a bottom sheet.
 *
 * The grid is FullCalendar v7 with no theme imported — every border, surface
 * and hue below comes from `tokens.css` through the library's per-element class
 * props.
 */
const meta: Meta = {
	title: "Flows/Calendar — A. Destination",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The week you land on. The rail carries the calendars and the suggestions the
 * reader has not answered yet; the grid carries everything that is already
 * agreed. Scroll the grid, step weeks with the arrows, and change the
 * magnification without losing the date.
 */
export const Week: Story = {
	render: () => <CalendarDestination />,
};

/**
 * Wednesday has five things booked on top of each other between ten and
 * quarter to twelve. Three columns is as far as the grid will subdivide: three
 * events are drawn and a "+2" beside them opens the other two. Five unreadable
 * slivers would be a rendering failure dressed up as completeness.
 */
export const DenseDay: Story = {
	render: () => <CalendarDestination view="day" date={densestDay.date} />,
};

/**
 * The same week at the next magnification out. All-day entries — a birthday, a
 * closed office, a three-day festival — run as bars across the days they cover
 * rather than being folded into the first morning.
 */
export const Month: Story = {
	render: () => <CalendarDestination view="month" />,
};

/** The widest step: a year, still the same strip, still the same Today. */
export const Year: Story = {
	render: () => <CalendarDestination view="year" />,
};

/**
 * Clicking an empty slot opens the editor over the grid. Title, when, and which
 * calendar; location, guests, repeat and notes are one disclosure away. The
 * week stays legible behind it, so you can see what you are booking against.
 */
export const CreateFromASlot: Story = {
	render: () => (
		<CalendarDestination
			draftAt={{
				date: "2026-06-11",
				startTime: "11:00",
				endTime: "12:00",
				allDay: false,
			}}
		/>
	),
};

/**
 * Type a sentence and watch it land in the form. Each reading names the words
 * it came from, and the reader says out loud both what it assumed and what the
 * sentence never told it. Edit the phrase — the fields follow every keystroke.
 */
export const TypeAnEvent: Story = {
	render: () => <CalendarDestination phrase="lunch with Jane friday 1pm" />,
};

/**
 * An event opened. It came out of a thread, so it carries the way back to that
 * thread as part of itself: "From this thread" opens the mail in the same pane,
 * with the way back to the event. The guest list shows who replied and who did
 * not — and it still does after an edit, because saving the form only writes
 * the fields the form shows.
 */
export const EventFromMail: Story = {
	render: () => (
		<CalendarDestination
			date={densestDay.date}
			selectedEventId="evt_q3_roadmap"
		/>
	),
};

/**
 * Editing one morning's standup asks which instances the change is for before
 * the form opens. Answering after the edit would mean typing a change without
 * knowing what it changes. The answer sticks to the event: say "the whole
 * series" and it is still a series afterwards, so the next edit asks again;
 * say "just this one" and that morning leaves the series for good.
 */
export const RecurrenceScope: Story = {
	render: () => <CalendarDestination scopeForEventId="evt_standup_10" />,
};

/**
 * Two calendars off. The rail is the legend and the filter at once, which is
 * the only arrangement where a coloured grid is readable — the key cannot be in
 * another room.
 */
export const FilteredCalendars: Story = {
	render: () => (
		<CalendarDestination hiddenCalendarIds={["cal_oncall", "cal_hobby"]} />
	),
};

/**
 * Tight density on the busiest day: the same events, half the slot height, the
 * time dropped off the shortest chips. How much of a day fits on a screen is
 * the reader's call, not ours.
 */
export const TightDensity: Story = {
	render: () => (
		<CalendarDestination view="day" date={densestDay.date} density="compact" />
	),
};

/* ------------------------------------------------------------------ */
/* Phone                                                               */
/* ------------------------------------------------------------------ */

/**
 * The phone is a day/agenda hybrid, not a shrunken week. The strip at the top
 * shows the shape of the day — where the gaps are — and the agenda under it
 * carries the events at a size a thumb can hit. The calendar chips stay on
 * screen, the view ladder and density sit in the bottom bar within reach, and
 * there are no keyboard hints anywhere.
 *
 * This is the week's quietest day, so the arrangement is judged on a day that
 * is mostly gap — which is what most days are.
 */
export const PhoneDay: Story = {
	name: "Phone — day",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			date={quietestDay.date}
		/>
	),
};

/**
 * The same crowded Wednesday. The strip shows the pile-up honestly; the agenda
 * below is where it becomes readable, because a phone has no room for three
 * columns of anything.
 */
export const PhoneDenseDay: Story = {
	name: "Phone — the dense day",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			date={densestDay.date}
		/>
	),
};

/**
 * A month on a phone is for choosing a day, so tapping one is the whole job:
 * the agenda below the grid moves to that day and names it. Making an event is
 * the button, where a thumb expects it — a mis-tap on a month grid should cost
 * a scroll, not a form.
 */
export const PhoneMonth: Story = {
	name: "Phone — month",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarDestination width={PHONE_WIDTH} view="month" />,
};

/**
 * Creating on a phone is a bottom sheet, not a popover: it comes from the edge
 * the thumb is on, and it can be dragged away without aiming at a close button.
 */
export const PhoneCreate: Story = {
	name: "Phone — create",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			sheet="create"
			draftAt={{
				date: "2026-06-11",
				startTime: "11:00",
				endTime: "12:00",
				allDay: false,
			}}
		/>
	),
};

/**
 * Typing an event on a phone is the fastest path by a wide margin, so the
 * sentence field sits at the top of the sheet with its reading directly below.
 */
export const PhoneTypeAnEvent: Story = {
	name: "Phone — type an event",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			sheet="create"
			phrase="coffee with Marcus thu 8am 30m"
		/>
	),
};

/** The event, its guests, and the thread it came from — full height, one thumb. */
export const PhoneEventDetail: Story = {
	name: "Phone — event from mail",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			date={densestDay.date}
			sheet="detail"
			selectedEventId="evt_q3_roadmap"
		/>
	),
};

/** The scope question, asked the same way and sized for a thumb. */
export const PhoneRecurrenceScope: Story = {
	name: "Phone — recurrence scope",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			sheet="create"
			scopeForEventId="evt_standup_10"
		/>
	),
};

/**
 * The suggestions the reader pulled out of mail, on their own sheet. Nothing on
 * this sheet is on the calendar, and nothing gets there without Add.
 */
export const PhoneSuggestions: Story = {
	name: "Phone — waiting for you",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination width={PHONE_WIDTH} view="day" sheet="suggestions" />
	),
};

/** Calendars are chips above the day, so filtering never costs a trip to settings. */
export const PhoneFilteredCalendars: Story = {
	name: "Phone — filtered calendars",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			hiddenCalendarIds={["cal_oncall", "cal_hobby"]}
		/>
	),
};
