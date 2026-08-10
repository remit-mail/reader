import type { Meta, StoryObj } from "@storybook/react-vite";
import { mostOverlappedDay, quietestDay } from "../fixtures/calendar.js";
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
 * events off the grid at once. An event is read and written in one place — the
 * right-hand pane — so there is a single editing surface on desktop and nothing
 * floats over the grid. A sentence typed into the quick-entry field is read live
 * into the fields below it, with each reading attributed to the words it came
 * from and every assumption named, so the machine is corrected before the event
 * exists. Nothing arrives from mail on its own: what the reader finds waits on a
 * dashed card off the grid until someone answers it, with Add or by correcting
 * it first — either way it is answered once and the card goes.
 *
 * The grid keeps the wider half of the split while it is the work. A week is
 * seven columns and a day is a ruler; a list pane sized for a message list makes
 * both unreadable, so the shell is told which pane is the work. Opening the
 * editor moves that answer: on a wide screen the panes even out for as long as
 * the form is open, and go back when it closes.
 *
 * A repeating event is a series, not five copies. The rule reads back in words —
 * "Every weekday, 09:15" — the editor sets it from the rules that day can repeat
 * by, and an instance that has been moved off the rule says so while staying in
 * the series.
 *
 * On a phone it is a different design, not the same one squeezed. The grid
 * shrinks to a strip that shows the shape of the day and the events become a
 * scrolling agenda under it. Anything with a decision in it takes the whole
 * screen — the same wizard chrome the selection flow uses, with back and cancel
 * in the header and the action in the thumb zone. Making an event is a walk of
 * four steps; reading one, filtering the calendars and answering a suggestion
 * are pages of their own.
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
export const OverlappingDay: Story = {
	name: "Overlapping day",
	render: () => (
		<CalendarDestination view="day" date={mostOverlappedDay.date} />
	),
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
 * Clicking an empty slot fills the right-hand pane with the form. Every field
 * is on screen and labelled — title, when, calendar, repeat, location, guests,
 * notes — because the pane has the room a popup did not. The week stays beside
 * it, so you can still see what you are booking against.
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
			date={mostOverlappedDay.date}
			selectedEventId="evt_q3_roadmap"
		/>
	),
};

/**
 * Editing one morning's standup asks which instances the change is for before
 * the form opens. Answering after the edit would mean typing a change without
 * knowing what it changes. The question is asked in the same pane the form then
 * fills, so the answer and the edit it gates are never in two places.
 *
 * "The whole series" and "this and following" rewrite every instance they cover,
 * each keeping the day it sits on. "Just this one" changes the morning and
 * leaves the rule alone — the series still owns it, so the next edit asks again
 * and the instance is marked as no longer matching.
 */
export const RecurrenceScope: Story = {
	render: () => <CalendarDestination scopeForEventId="evt_standup_10" />,
};

/**
 * Thursday's standup was pushed and the rest of the week was not. The rule still
 * reads back, because the morning is still part of the series; what the badge
 * adds is that this one no longer matches it.
 */
export const SeriesException: Story = {
	render: () => (
		<CalendarDestination date="2026-06-11" selectedEventId="evt_standup_11" />
	),
};

/**
 * Editing the weekly 1:1 with the scope question answered. Repeat is a rule the
 * form sets from the ones this day can repeat by, in the words the detail pane
 * reads back — nobody types an RRULE and nobody is shown one.
 */
export const EditARepeatRule: Story = {
	render: () => <CalendarDestination scopeForEventId="evt_marcus_1to1" />,
};

/**
 * The rule the offered choices cannot express: every other Tuesday, or Mondays
 * and Thursdays until October. This is the one thing that floats over the pane,
 * and it earns it — a nested decision inside the form is not a second form, and
 * the event stays readable behind it. Done writes the rule back in words.
 */
export const CustomRepeat: Story = {
	name: "Custom repeat",
	render: () => (
		<CalendarDestination
			draftAt={{
				date: "2026-06-11",
				startTime: "11:00",
				endTime: "12:00",
				allDay: false,
			}}
			customRepeat="open"
		/>
	),
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

/* ------------------------------------------------------------------ */
/* Phone                                                               */
/* ------------------------------------------------------------------ */

/**
 * The phone is a day/agenda hybrid, not a shrunken week. The strip at the top
 * shows the shape of the day — where the gaps are — and the agenda under it
 * carries the events at a size a thumb can hit. The calendar chips stay on
 * screen, the view ladder sits in the bottom bar within reach, and there are no
 * keyboard hints anywhere.
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
 * The same crowded Wednesday, where five things sit on top of each other. The
 * strip shows the pile-up honestly; the agenda below is where it becomes
 * readable, because a phone has no room for three columns of anything.
 */
export const PhoneOverlappingDay: Story = {
	name: "Phone — overlapping day",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			date={mostOverlappedDay.date}
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
 * Creating on a phone takes the whole screen and asks one thing at a time:
 * what, when, who, and where it lands. A single cramped form at 390 points
 * either hides half the event behind a fold or asks a thumb to hit a
 * fifteen-minute target; four steps do neither. Back and cancel are in the
 * header, Continue is under the thumb, and the rail says how far along it is.
 */
export const PhoneCreate: Story = {
	name: "Phone — create, step 1",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			flow="editor"
			draftAt={{
				date: "2026-06-11",
				startTime: "11:00",
				endTime: "12:00",
				allDay: false,
			}}
		/>
	),
};

/** The second step: the day, the hours, and how it repeats, each with room. */
export const PhoneCreateWhen: Story = {
	name: "Phone — create, when",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			flow="editor"
			step={1}
			draftAt={{
				date: "2026-06-11",
				startTime: "11:00",
				endTime: "12:00",
				allDay: false,
			}}
		/>
	),
};

/** The last step, where the event gets a calendar and Add is the action. */
export const PhoneCreateWhereItLands: Story = {
	name: "Phone — create, where it lands",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			flow="editor"
			step={3}
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
 * sentence field opens the walk: it is the first step, with its reading
 * directly under it and the title it produced below that. Walking on confirms
 * the rest rather than retyping it.
 */
export const PhoneTypeAnEvent: Story = {
	name: "Phone — type an event",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			flow="editor"
			phrase="coffee with Marcus thu 8am 30m"
		/>
	),
};

/**
 * The event, its guests, and the thread it came from, on a screen of its own.
 * Back is the way to the grid and Edit is under the thumb.
 */
export const PhoneEventDetail: Story = {
	name: "Phone — event from mail",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			date={mostOverlappedDay.date}
			flow="event"
			selectedEventId="evt_q3_roadmap"
		/>
	),
};

/**
 * The scope question is the first step of editing a series, not a sheet over
 * the form. Which instances a change reaches decides what the change means, so
 * it is settled on its own screen and the form is the step behind it.
 */
export const PhoneRecurrenceScope: Story = {
	name: "Phone — recurrence scope",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			flow="editor"
			scopeForEventId="evt_standup_10"
		/>
	),
};

/**
 * The suggestions the reader pulled out of mail, on a screen of their own.
 * Nothing here is on the calendar, and nothing gets there without Add.
 * Correcting a reading first opens the create walk with the reading in it.
 */
export const PhoneSuggestions: Story = {
	name: "Phone — waiting for you",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination width={PHONE_WIDTH} view="day" flow="suggestions" />
	),
};

/**
 * The same rule editor on a phone. It opens from the repeat picker on the When
 * step and takes the screen, because a sheet dragged over a page that already
 * fills the screen is the pattern this surface got rid of. Done returns to the
 * walk with the rule in the field.
 */
export const PhoneCustomRepeat: Story = {
	name: "Phone — custom repeat",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination
			width={PHONE_WIDTH}
			view="day"
			flow="editor"
			step={1}
			customRepeat="open"
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
 * The chips above the day are the legend and the quick filter, always on
 * screen. The whole list — every account, all and none — is a screen rather
 * than a drawer, so a filter is never something that slides half over the grid.
 */
export const PhoneCalendars: Story = {
	name: "Phone — calendars",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarDestination width={PHONE_WIDTH} view="day" flow="calendars" />
	),
};

/** Two calendars off, and the grid says so the moment they go. */
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
