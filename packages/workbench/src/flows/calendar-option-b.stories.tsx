import type { Meta, StoryObj } from "@storybook/react-vite";
import { PHONE_WIDTH, phoneFrame, phoneParams } from "../lib/story-frame.js";
import { CalendarSeam } from "../screens/calendar-seam.js";

/**
 * Option B bets that the calendar's advantage is not the grid. Every calendar
 * has a grid, and the good ones have had one for twenty years. What no calendar
 * has is the mail that decides the time: the invitation, the flight
 * confirmation, the thread asking whether Thursday works. Reader owns both
 * sides, so time is put where the decision is being made rather than on a page
 * you have to go to.
 *
 * What it commits to. An invitation states its clash before it offers Accept —
 * across accounts, which is where the collisions that actually hurt live, and
 * which is the one thing a calendar that cannot see your mail can never do. A
 * thread that proposes times has that day's availability beside it, with each
 * proposed hour marked against what is already booked. Answering with times
 * writes them into the reply as plain text and lays them on the calendar as
 * holds that are drawn provisional and release themselves.
 *
 * What it refuses. Nothing reaches the calendar because software read a mail.
 * A reading is a card, off the grid, dashed, with the thread it came from and
 * the field or phrase it rests on; the only path onto the calendar is a person
 * pressing Confirm. One junk event costs more trust than the feature will ever
 * earn back, so the failure mode chosen is doing nothing. The readings run in
 * order — an attached invitation first, then machine-readable markup, and only
 * then a pattern in the prose — and each card says which rung answered, because
 * a field the sender stated and a phrase software interpreted are not the same
 * claim. A time whose zone the mail never gave stops the Confirm until someone
 * picks a clock. Dropping a reading offers a rule about the sender, so the next
 * twenty go away too.
 *
 * On a phone the shape changes rather than shrinking. The day does not fit
 * beside the message at 390px, so answering with times is a walk of three
 * screens — read the day, pick the half-hours, send the reply — in the same
 * wizard chrome the selection flow uses. The pending readings are a deck you
 * swipe on a screen of their own, with the buttons still under the card,
 * because a gesture is never the only way to answer.
 */
const meta: Meta = {
	title: "Flows/Calendar — B. Seam",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * An invitation, and the thing every mail client leaves out. The invite parsed
 * cleanly — a text/calendar part came with it, so these are Priya's own fields
 * rather than a reading of her prose — and the clash under it is with a dentist
 * appointment on the personal account. Two calendars, two accounts, one
 * afternoon. Answer it and the day beside the thread moves.
 */
export const InviteWithTheClash: Story = {
	render: () => <CalendarSeam />,
};

/**
 * The same invitation, accepted. It is on the calendar now, the day beside it
 * has it, and the dentist is still there underneath — the clash was not
 * resolved by answering, it was made visible before answering. Declining puts
 * "offer other times" in reach instead.
 */
export const InviteAnswered: Story = {
	render: () => <CalendarSeam inviteRsvp="accepted" />,
};

/**
 * "Can we do Thursday?" — three times named in prose, each underlined where it
 * was written and each checked against the day. Two of the three are already
 * booked, and that is readable without leaving the message. Click a phrase to
 * take its mark off the day and put it back.
 */
export const TimesProposedInProse: Story = {
	render: () => <CalendarSeam threadId="thr_thursday" />,
};

/**
 * Answering with times. The slots picked off the availability rail go into the
 * reply as plain text, because the person receiving it may be reading in
 * anything, and the same slots draw on the day as pending offers. Nothing is
 * committed yet.
 */
export const ReplyWithTimes: Story = {
	render: () => (
		<CalendarSeam
			threadId="thr_thursday"
			pickedSlots={["11:30", "15:00", "16:00"]}
		/>
	),
};

/**
 * Sent. The three offers are now holds: dashed, in the second accent rather
 * than a calendar's own hue, and labelled with the hour they cover. They are
 * private, they are not events, and they release themselves on Friday morning
 * if nobody takes one — an offer you have forgotten you made is how a double
 * booking happens.
 */
export const HoldsUntilAnswered: Story = {
	render: () => (
		<CalendarSeam
			threadId="thr_thursday"
			pickedSlots={["11:30", "15:00", "16:00"]}
			replySent
		/>
	),
};

/**
 * Everything read out of mail, in the list pane, none of it on the calendar.
 * Each card carries the thread it came from and the rung of the ladder that
 * answered: an airline's booking block, a lodging reservation, two readings of
 * plain prose. The badge is the point — a field the sender stated and a phrase
 * software interpreted deserve different amounts of trust.
 */
export const PendingReadings: Story = {
	render: () => <CalendarSeam suggestionsOpen threadId="" />,
};

/**
 * A reading opened up. The restaurant booking came out of a sentence, so the
 * card shows the sentence, the fields it produced, and which words produced
 * each one. "The Friday after the offsite" is a chain of inferences, and the
 * card says so rather than presenting 19 June as a fact.
 */
export const HowItWasRead: Story = {
	render: () => (
		<CalendarSeam
			suggestionsOpen
			threadId=""
			expandedSuggestionId="sug_toscanini"
		/>
	),
};

/**
 * A time we cannot determine. The airline printed 20:25 for the arrival and
 * never said whose clock it is on; Lisbon runs an hour behind. The reader will
 * not choose, so Confirm stays inert until a clock is picked. Guessing here
 * would put a wrong hour on the calendar and look exactly like a right one.
 */
export const ZoneWeCannotDetermine: Story = {
	render: () => (
		<CalendarSeam
			suggestionsOpen
			threadId=""
			expandedSuggestionId="sug_flight"
		/>
	),
};

/**
 * A dropped reading is worth more than a dismissal. The card is gone, the undo
 * is still there, and the offer is a rule about the sender rather than about
 * this one parcel — bol.com will send forty more of these. Taking the rule
 * stops the readings, not the mail.
 */
export const DroppingTeachesARule: Story = {
	render: () => (
		<CalendarSeam
			suggestionsOpen
			threadId=""
			rejectedSuggestionId="sug_parcel"
		/>
	),
};

/**
 * An event opened from the day beside a thread. Under the facts is the
 * correspondence that produced it, still live: the last message arrived after
 * the event was already on the calendar and says the organiser is running
 * fifteen late. In a calendar that only holds events, that message is in
 * another application.
 */
export const EventWithItsThread: Story = {
	render: () => <CalendarSeam threadId="" selectedEventId="evt_q3_roadmap" />,
};

/**
 * A guest is a correspondent. Pointing at one opens what they have written
 * lately, which is usually the context you were about to go looking for
 * anyway — and the only reason it is one hover away is that the mail and the
 * calendar are the same application.
 */
export const AttendeeContext: Story = {
	render: () => (
		<CalendarSeam
			threadId=""
			selectedEventId="evt_q3_roadmap"
			activeAttendee="priya@northwind.example"
		/>
	),
};

/* ------------------------------------------------------------------ */
/* Phone                                                               */
/* ------------------------------------------------------------------ */

/**
 * The invitation on a phone. The clash keeps its place above the answer, and
 * the three answers are a full-width row a thumb can hit without aiming. The
 * day does not fit beside the message at 390px, so it is one tap away in the
 * header rather than squeezed into a column nobody can read.
 */
export const PhoneInvite: Story = {
	name: "Phone — invite with the clash",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarSeam width={PHONE_WIDTH} />,
};

/**
 * The proposal thread. The verdict on each named time is in the message, in
 * words, because a coloured band is not readable at this width — the band is
 * what the day screen is for, one tap away in the header.
 */
export const PhoneProposedTimes: Story = {
	name: "Phone — times proposed in prose",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <CalendarSeam width={PHONE_WIDTH} threadId="thr_thursday" />,
};

/**
 * The day, first step of answering with times. It is the whole screen because
 * a band of booked hours is unreadable in a strip beside a message at this
 * width — and tapping a block opens the event it belongs to.
 */
export const PhoneTheDay: Story = {
	name: "Phone — the day",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarSeam width={PHONE_WIDTH} threadId="thr_thursday" flow="day" />
	),
};

/**
 * The second step: the free half-hours as a scrolling rail of chips at touch
 * size, with the day still above them so a pick is judged against what is
 * already booked. Continue is inert until something is picked, and says why.
 */
export const PhonePickTimes: Story = {
	name: "Phone — pick times",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarSeam
			width={PHONE_WIDTH}
			threadId="thr_thursday"
			flow="day"
			step={1}
			pickedSlots={["11:30", "15:00"]}
		/>
	),
};

/**
 * The last step. The picked slots are already in the draft as plain text, and
 * sending lays them on the day as holds that release themselves.
 */
export const PhoneReplyStep: Story = {
	name: "Phone — send the reply",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarSeam
			width={PHONE_WIDTH}
			threadId="thr_thursday"
			flow="day"
			step={2}
			pickedSlots={["11:30", "15:00", "16:00"]}
		/>
	),
};

/** The reply in the thread itself, where it stays after the walk closes. */
export const PhoneReplyWithTimes: Story = {
	name: "Phone — reply with times",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarSeam
			width={PHONE_WIDTH}
			threadId="thr_thursday"
			pickedSlots={["11:30", "15:00", "16:00"]}
		/>
	),
};

/**
 * The pending readings as a deck rather than a column: one decision fills the
 * screen, swipe right to confirm and left to drop. The buttons stay under the
 * card — a gesture is a shortcut for people who know it, never the only way in.
 */
export const PhoneReadingDeck: Story = {
	name: "Phone — the deck",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarSeam
			width={PHONE_WIDTH}
			threadId=""
			flow="suggestions"
			topSuggestionId="sug_toscanini"
		/>
	),
};

/**
 * The zone we cannot determine, face up on the deck. Swiping right does not
 * confirm it either: the gesture reports the same block the button does, and
 * says what is missing.
 */
export const PhoneZoneWeCannotDetermine: Story = {
	name: "Phone — which clock?",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarSeam
			width={PHONE_WIDTH}
			threadId=""
			flow="suggestions"
			topSuggestionId="sug_flight"
			expandedSuggestionId="sug_flight"
		/>
	),
};

/** Dropping a reading, and the sender rule it offers, at thumb size. */
export const PhoneDroppingTeachesARule: Story = {
	name: "Phone — dropping teaches a rule",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarSeam
			width={PHONE_WIDTH}
			threadId=""
			flow="suggestions"
			rejectedSuggestionId="sug_parcel"
		/>
	),
};

/** The event and its thread, full height, one thumb. */
export const PhoneEventWithItsThread: Story = {
	name: "Phone — event with its thread",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarSeam
			width={PHONE_WIDTH}
			threadId=""
			selectedEventId="evt_q3_roadmap"
		/>
	),
};

/**
 * A guest tapped. There is no room at this width for a card under the finger
 * that opened it, so what they have written lately is a screen with the way
 * back to the event in its header.
 */
export const PhoneAttendeeContext: Story = {
	name: "Phone — attendee context",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<CalendarSeam
			width={PHONE_WIDTH}
			threadId=""
			selectedEventId="evt_q3_roadmap"
			activeAttendee="priya@northwind.example"
			flow="attendee"
		/>
	),
};
