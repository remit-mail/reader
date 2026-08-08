import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
	CalendarDescriptor,
	CalendarEventData,
} from "./calendar-types.js";
import { EventDetail } from "./event-detail.js";

/**
 * An event opened. The thread it came out of is part of the event rather than a
 * footnote, so nothing that started as mail is ever a dead end.
 */
const meta: Meta<typeof EventDetail> = {
	title: "Calendar/Event detail",
	component: EventDetail,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-[560px] max-w-lg border border-line">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof EventDetail>;

const calendar: CalendarDescriptor = {
	id: "c1",
	accountId: "a1",
	accountLabel: "Work",
	name: "Northwind",
	color: "cal-1",
};

const base: CalendarEventData = {
	id: "e1",
	calendarId: "c1",
	title: "Q3 roadmap review",
	start: "2026-06-10T10:00:00+02:00",
	end: "2026-06-10T11:30:00+02:00",
	allDay: false,
	location: "Room Zuid",
	notes: "Pre-read is in the thread. Bring the staffing numbers.",
	attendees: [
		{
			name: "Priya Natarajan",
			email: "priya@northwind.example",
			rsvp: "accepted",
			role: "organizer",
		},
		{
			name: "Marcus Webb",
			email: "marcus@northwind.example",
			rsvp: "accepted",
			role: "attendee",
		},
		{
			name: "Dana Okafor",
			email: "dana@northwind.example",
			rsvp: "tentative",
			role: "attendee",
		},
		{
			name: "Sven Larsen",
			email: "sven@northwind.example",
			rsvp: "declined",
			role: "attendee",
		},
	],
	myRsvp: "accepted",
	threadId: "thr_q3",
	threadSubject: "Q3 roadmap review — agenda + pre-read",
	timeZone: "Europe/Amsterdam",
	zoneCertainty: "local",
	recurrenceRule: "",
	seriesId: "",
	status: "confirmed",
};

/** Born from a thread, and one click from it. */
export const FromMail: Story = {
	render: () => (
		<EventDetail
			event={base}
			calendar={calendar}
			whenText="Wednesday 10 June · 10:00 – 11:30"
			onEdit={() => {}}
			onDelete={() => {}}
			onOpenThread={() => {}}
		/>
	),
};

/** A repeating instance names its rule instead of hiding it in a settings pane. */
export const Recurring: Story = {
	render: () => (
		<EventDetail
			event={{
				...base,
				title: "Standup",
				start: "2026-06-10T09:15:00+02:00",
				end: "2026-06-10T09:30:00+02:00",
				location: "Huddle room",
				notes: "",
				threadId: "",
				threadSubject: "",
				recurrenceRule: "Every weekday at 09:15",
				seriesId: "ser_standup",
			}}
			calendar={calendar}
			whenText="Wednesday 10 June · 09:15 – 09:30"
			onEdit={() => {}}
			onDelete={() => {}}
		/>
	),
};

/**
 * A zone we cannot determine is shown as unknown. Guessing quietly is how
 * someone ends up on the wrong side of a two-hour gap.
 */
export const AmbiguousZone: Story = {
	render: () => (
		<EventDetail
			event={{
				...base,
				title: "Offsite dinner",
				start: "2026-06-11T19:00:00+02:00",
				end: "2026-06-11T22:00:00+02:00",
				location: "Toscanini",
				notes: 'The thread says "dinner at 7" and never says where anyone is.',
				timeZone: "",
				zoneCertainty: "ambiguous",
				threadId: "thr_dana",
				threadSubject: "Offsite logistics — rooms, travel, the dinner",
			}}
			calendar={calendar}
			whenText="Thursday 11 June · 19:00 – 22:00"
			onEdit={() => {}}
			onDelete={() => {}}
			onOpenThread={() => {}}
		/>
	),
};
