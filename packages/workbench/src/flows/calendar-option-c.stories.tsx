import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PHONE_WIDTH, phoneFrame, phoneParams } from "../lib/story-frame.js";
import { CalendarAgenda } from "../screens/calendar-agenda.js";

/**
 * Option C disagrees with the week grid.
 *
 * A time grid gives every hour the same number of pixels, which means a calendar
 * that is two-thirds empty spends two-thirds of the screen drawing nothing. The
 * same layout then gets shipped to a 390px phone, where a seven-column grid is
 * unreadable and everyone taps through to the day view anyway. So the primary
 * object here is a single scrolling list of days — time as one strip you fall
 * through — and the grid is demoted to a zoom level you drop into when a day
 * has enough overlapping events to need columns.
 *
 * What it commits to. Scrolling never paginates: reaching either end of the
 * strip loads more days under you and holds your position, and Today is the same
 * target from anywhere. Empty time is drawn rather than left blank — a free
 * afternoon gets a band, an empty day gets a line, a week away gets one
 * sentence. Density is three steps, from a month of coloured dots to a stack of
 * cards, because how much a day should cost in pixels is the reader's call.
 * Typing is the create path: the sentence is read on every keystroke straight
 * into the fields below it, and where a sentence has two honest readings the
 * reader asks which one instead of picking.
 *
 * On a wide screen the strip does not stretch. The extra width goes to the
 * questions a list answers well and a grid answers badly — what is next, where
 * the open time is, and where in the strip you are — while the days themselves
 * keep a readable measure.
 *
 * On a phone the strip is the whole screen, so anything with a decision in it
 * takes the whole screen too: the same wizard chrome the selection flow uses,
 * back and cancel in the header, the action in the thumb zone. Making an event
 * walks four steps starting from the sentence; reading one, filtering the
 * calendars and answering a suggestion are pages of their own.
 */
const meta: Meta = {
	title: "Flows/Calendar — C. Agenda",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The strip on the day it lands. Today carries the accent rail, the days above
 * and below it run continuously, and the map on the left is both where you are
 * and how full the month is. Scroll far enough in either direction and more days
 * arrive without a page break.
 */
export const Agenda: Story = {
	render: () => <CalendarAgenda />,
};

/**
 * The same strip read as a month of dots. One line a day, colour for the
 * calendar, a bar for where the hours went — five weeks fit on a screen at a
 * size where the shape of the month is still legible.
 */
export const GlanceDensity: Story = {
	name: "Density — dots",
	render: () => <CalendarAgenda density="dots" />,
};

/**
 * The other end of the ladder. Every event is a card with its calendar, its
 * place and its guest count, and the free bands between them are sized the same
 * way — a day is a document rather than a row.
 */
export const DetailDensity: Story = {
	name: "Density — detail",
	render: () => <CalendarAgenda density="detail" />,
};

/**
 * Wednesday has five things booked on top of each other between ten and quarter
 * to twelve. The list refuses to pretend five rows is the truth: it brackets
 * them, says four are running at once, and offers the grid. This is the case
 * that justifies a time grid existing at all.
 */
export const TheOverlappingDay: Story = {
	name: "The overlapping day",
	render: () => <CalendarAgenda date="2026-06-10" density="detail" />,
};

/**
 * The grid, entered from that Wednesday. It earns its columns here: the overlap
 * has a shape, and the shape is the information. Switching back to the list
 * returns to the same day rather than to wherever the list was left.
 */
export const ZoomedIntoTheGrid: Story = {
	render: () => <CalendarAgenda view="day" date="2026-06-10" />,
};

/**
 * The same grid on the quiet Monday, for comparison. Three events, fourteen
 * hours of ruled empty rows. Nothing is wrong with the rendering; the layout is
 * simply spending its pixels on hours rather than on events, which is the
 * default this option rejects.
 */
export const TheGridOnALightDay: Story = {
	render: () => <CalendarAgenda view="day" date="2026-06-08" />,
};

/**
 * Saturday the 20th to Thursday the 25th is one line, because that is all it is
 * worth. The Lisbon stay is still sitting unaccepted in the suggestions, so
 * those days really are unbooked — and the strip says so instead of scrolling
 * you through five empty screens to find out.
 */
export const AFreeWeek: Story = {
	render: () => <CalendarAgenda date="2026-06-20" />,
};

/**
 * Thursday, with the gaps drawn. Four and three-quarter hours before the dentist
 * and three and a half after it are objects on the day, not the absence of
 * objects — tapping either starts an event there.
 */
export const FreeAfternoons: Story = {
	render: () => <CalendarAgenda date="2026-06-11" density="detail" />,
};

/**
 * The reading on the right is the one a grid cannot give you without hunting for
 * the now-line: what is running, what is next and how long until it, what
 * follows that, and when the day next opens up.
 */
export const WhatIsNext: Story = {
	render: () => <CalendarAgenda density="detail" />,
};

/**
 * A sentence typed into the field lands in the fields under it on every
 * keystroke. "Friday" has two honest readings this far into a week, so the
 * reader asks which one rather than choosing; the rest is already filled in, and
 * every reading names the words it came from. Edit the sentence — the form
 * follows.
 */
export const TypeAnEvent: Story = {
	render: () => <CalendarAgenda phrase="lunch with Jane friday 1pm" />,
};

/**
 * A repeat, typed. The rule is read out of the sentence and put in the form, and
 * the thing the sentence never said — when it stops — is said out loud instead
 * of being defaulted quietly to forever.
 */
export const TypeARepeatingEvent: Story = {
	render: () => <CalendarAgenda phrase="standup every weekday 9:30" />,
};

/**
 * "At 8" is two different appointments. Neither is more correct, so the reader
 * shows both and applies the likelier one until told otherwise — one tap moves
 * it, and the form moves with it.
 */
export const AnAmbiguousTime: Story = {
	render: () => <CalendarAgenda phrase="coffee with Marcus at 8" />,
};

/**
 * Times, a place and a length, all out of one line. The range sets both ends, so
 * nothing is assumed about how long lunch is.
 */
export const TypeATimeRange: Story = {
	render: () => (
		<CalendarAgenda phrase="team lunch 12:30-14:00 june 17 @ Toscanini" />
	),
};

/**
 * An event opened. It came out of a thread, so the way back to that thread is
 * part of the event rather than a footnote, and the guest list shows who
 * answered.
 */
export const EventFromMail: Story = {
	render: () => (
		<CalendarAgenda date="2026-06-10" selectedEventId="evt_q3_roadmap" />
	),
};

/**
 * The way back to the mail, taken. The thread opens in the pane the event was
 * in, behind a bar that says where back goes — the event is still selected, so
 * back is the event rather than the strip.
 */
export const EventThread: Story = {
	name: "The thread the event came from",
	render: () => (
		<CalendarAgenda date="2026-06-10" selectedEventId="evt_q3_roadmap" />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await userEvent.click(canvas.getByText("From this thread"));

		await waitFor(() =>
			expect(
				canvas.getByRole("heading", {
					name: "Q3 roadmap review — agenda + pre-read",
				}),
			).toBeInTheDocument(),
		);
		await expect(canvas.getByText("3 messages")).toBeInTheDocument();

		await userEvent.click(canvas.getByText("Back to the event"));

		await waitFor(() =>
			expect(canvas.getByText("From this thread")).toBeInTheDocument(),
		);
	},
};

/**
 * The mail is gone — filed, deleted or on an account that has since been
 * removed. The pane says so where the thread would have been, and back is where
 * it always was, because a button that answers with nothing is the one failure
 * a reader cannot tell apart from a broken build.
 */
export const ThreadGone: Story = {
	name: "The thread is gone",
	render: () => (
		<CalendarAgenda
			date="2026-06-10"
			selectedEventId="evt_q3_roadmap"
			openThreadId="thr_filed_away"
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await expect(
			canvas.getByText("That mail is not in this mailbox any more"),
		).toBeInTheDocument();

		await userEvent.click(canvas.getByText("Back to the event"));

		await waitFor(() =>
			expect(canvas.getByText("From this thread")).toBeInTheDocument(),
		);
	},
};

/**
 * Making an event while a thread is open. The pane belongs to the event that
 * was just made, not to the mail that was being read before it — a thread left
 * standing there reads as the new event's mail, and it is not.
 */
export const ThreadMakesWay: Story = {
	name: "The thread makes way for a new event",
	render: () => (
		<CalendarAgenda
			date="2026-06-10"
			selectedEventId="evt_q3_roadmap"
			openThreadId="thr_q3"
			phrase="lunch with Jane friday 1pm"
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const subject = "Q3 roadmap review — agenda + pre-read";

		await expect(
			canvas.getByRole("heading", { name: subject }),
		).toBeInTheDocument();

		await userEvent.click(canvas.getByLabelText("Describe the event"));
		await userEvent.keyboard("{Enter}");

		await waitFor(() =>
			expect(canvas.queryByRole("heading", { name: subject })).toBeNull(),
		);
	},
};

/**
 * Editing one morning's standup asks which instances it is for before the form
 * opens. Answering afterwards would mean typing a change without knowing what it
 * changes. "The whole series" and "this and following" rewrite every instance
 * they cover; "just this one" changes the morning and leaves the rule standing.
 */
export const RecurrenceScope: Story = {
	render: () => <CalendarAgenda scopeForEventId="evt_standup_10" />,
};

/**
 * A rule the offered choices cannot express — every other week, two days of it,
 * stopping in October. It is the one thing here that floats over the composer,
 * and it earns that: a nested decision inside a form is not a second form, and
 * the sentence being edited stays readable behind it. Done writes the rule back
 * in the same words the field already reads.
 */
export const CustomRepeat: Story = {
	name: "Custom repeat",
	render: () => (
		<CalendarAgenda phrase="standup every weekday 9:30" customRepeat="open" />
	),
};

/**
 * Two calendars off. The list is the legend and the filter at once and stays on
 * screen beside the strip, so the colours mean something while you read them.
 */
export const FilteredCalendars: Story = {
	render: () => (
		<CalendarAgenda hiddenCalendarIds={["cal_oncall", "cal_hobby"]} />
	),
};

/**
 * The month, as a step out rather than a different screen. It keeps the focused
 * day, and picking a day drops back into the strip at that day.
 */
export const Month: Story = {
	render: () => <CalendarAgenda view="month" />,
};

/** The widest step: a year, still the same strip, still the same Today. */
export const Year: Story = {
	render: () => <CalendarAgenda view="year" />,
};

/* ------------------------------------------------------------------ */
/* Phone                                                               */
/* ------------------------------------------------------------------ */

/**
 * This is the argument. The phone gets the same object as the desktop, at full
 * width, with nothing cut: what is next at the top, then the strip. No
 * seven-column grid squeezed into 390 points, no tapping through a month cell to
 * find out what a dot means.
 */
export const PhoneAgenda: Story = {
	name: "Phone — the strip",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarAgenda width={PHONE_WIDTH} />,
};

/**
 * A month of days on a phone screen, in one thumb-scroll. The dots carry the
 * calendar colours and the bars carry the shape of each day; it is the month
 * view's job done in the space the month view wastes on grid lines.
 */
export const PhoneGlance: Story = {
	name: "Phone — dots",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarAgenda width={PHONE_WIDTH} density="dots" />,
};

/** Full cards on a phone: one day fills the screen, and everything is thumbable. */
export const PhoneDetail: Story = {
	name: "Phone — detail",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarAgenda width={PHONE_WIDTH} density="detail" />,
};

/**
 * The crowded Wednesday on a phone. The pile-up is named and bracketed rather
 * than drawn as four unreadable slivers, and the grid is one tap away for
 * anyone who wants to see the overlap itself.
 */
export const PhoneOverlappingDay: Story = {
	name: "Phone — overlapping day",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarAgenda width={PHONE_WIDTH} date="2026-06-10" />,
};

/**
 * The day grid on a phone, for the same Wednesday. It is the honest version of
 * what a grid-first calendar asks a phone to do: one column, half the labels
 * dropped, and the overlap still barely legible.
 */
export const PhoneGrid: Story = {
	name: "Phone — the grid",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarAgenda width={PHONE_WIDTH} view="day" date="2026-06-10" />
	),
};

/** Five days away, in one line, on the screen where scrolling costs the most. */
export const PhoneFreeWeek: Story = {
	name: "Phone — a free week",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarAgenda width={PHONE_WIDTH} date="2026-06-20" />,
};

/**
 * What is next, on the surface where it is asked most often. It sits above the
 * strip and scrolls away with it, so it is an answer rather than a permanent
 * band of chrome.
 */
export const PhoneWhatIsNext: Story = {
	name: "Phone — what's next",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarAgenda width={PHONE_WIDTH} density="detail" />,
};

/**
 * Typing on a phone is worth more than anywhere else, so the sentence is the
 * first step of the walk rather than a field above a folded form: the reading
 * sits directly under it and the ambiguity is two thumb-sized buttons. The
 * steps after it ask for what the sentence never said.
 */
export const PhoneTypeAnEvent: Story = {
	name: "Phone — type an event",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarAgenda
			width={PHONE_WIDTH}
			flow="editor"
			phrase="lunch with Jane friday 1pm"
		/>
	),
};

/** The same first step, reading a repeat out of the sentence. */
export const PhoneTypeARepeatingEvent: Story = {
	name: "Phone — type a repeat",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarAgenda
			width={PHONE_WIDTH}
			flow="editor"
			phrase="standup every weekday 9:30"
		/>
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
		<CalendarAgenda
			width={PHONE_WIDTH}
			flow="editor"
			step={1}
			customRepeat="open"
			phrase="standup every weekday 9:30"
		/>
	),
};

/** The step that takes the sentence's reading and lets you correct the hours. */
export const PhoneCreateWhen: Story = {
	name: "Phone — create, when",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarAgenda
			width={PHONE_WIDTH}
			flow="editor"
			step={1}
			phrase="lunch with Jane friday 1pm"
		/>
	),
};

/**
 * The event, its guests and the thread it came from, on a screen of its own.
 * Back is the way to the strip and Edit is under the thumb.
 */
export const PhoneEventFromMail: Story = {
	name: "Phone — event from mail",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarAgenda
			width={PHONE_WIDTH}
			date="2026-06-10"
			flow="event"
			selectedEventId="evt_q3_roadmap"
		/>
	),
};

/**
 * The thread, on a screen of its own, entered from the event. Back returns to
 * the event it was opened from rather than dropping to the strip.
 */
export const PhoneEventThread: Story = {
	name: "Phone — the thread",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarAgenda
			width={PHONE_WIDTH}
			date="2026-06-10"
			flow="event"
			selectedEventId="evt_q3_roadmap"
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await userEvent.click(canvas.getByText("From this thread"));

		await waitFor(() =>
			expect(canvas.getByText("3 messages")).toBeInTheDocument(),
		);

		await userEvent.click(canvas.getByLabelText("Back"));

		await waitFor(() =>
			expect(canvas.getByText("From this thread")).toBeInTheDocument(),
		);
	},
};

/**
 * The dates the reader found in mail, on a screen of their own. Nothing here is
 * on the calendar, and nothing gets there without Add — which is why the week in
 * Lisbon still reads as five free days.
 */
export const PhoneSuggestions: Story = {
	name: "Phone — waiting for you",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarAgenda width={PHONE_WIDTH} flow="suggestions" />,
};

/**
 * The same missing mail on the screen where a blank one would be a dead end:
 * the phone has nothing behind the thread to fall back to, so the screen says
 * what happened and keeps its way back.
 */
export const PhoneThreadGone: Story = {
	name: "Phone — the thread is gone",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarAgenda
			width={PHONE_WIDTH}
			date="2026-06-10"
			flow="event"
			selectedEventId="evt_q3_roadmap"
			openThreadId="thr_filed_away"
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await expect(
			canvas.getByText("That mail is not in this mailbox any more"),
		).toBeInTheDocument();

		await userEvent.click(canvas.getByLabelText("Back"));

		await waitFor(() =>
			expect(canvas.getByText("From this thread")).toBeInTheDocument(),
		);
	},
};

/**
 * A suggestion is a reading of a mail, so the mail it was read from is one tap
 * away — and back is the list of suggestions, not the strip underneath it.
 */
export const PhoneSuggestionThread: Story = {
	name: "Phone — the mail behind a suggestion",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarAgenda width={PHONE_WIDTH} flow="suggestions" />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const link = "Airbnb — Your reservation in Lisbon is confirmed";

		await userEvent.click(canvas.getByText(link));

		await waitFor(() =>
			expect(canvas.getByText("1 message")).toBeInTheDocument(),
		);

		await userEvent.click(canvas.getByLabelText("Back"));

		await waitFor(() => expect(canvas.getByText(link)).toBeInTheDocument());
	},
};

/**
 * The chips above the strip are the legend and the quick filter. The whole
 * list — every account, all and none — is a screen rather than a drawer.
 */
export const PhoneCalendars: Story = {
	name: "Phone — calendars",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarAgenda width={PHONE_WIDTH} flow="calendars" />,
};

/**
 * The scope question is the first step of editing a series, not a sheet over
 * the form: which instances a change reaches decides what the change means.
 */
export const PhoneRecurrenceScope: Story = {
	name: "Phone — recurrence scope",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarAgenda
			width={PHONE_WIDTH}
			flow="editor"
			scopeForEventId="evt_standup_10"
		/>
	),
};

/** Two calendars off, and the strip says so the moment they go. */
export const PhoneFilteredCalendars: Story = {
	name: "Phone — filtered calendars",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarAgenda
			width={PHONE_WIDTH}
			hiddenCalendarIds={["cal_oncall", "cal_hobby"]}
		/>
	),
};
