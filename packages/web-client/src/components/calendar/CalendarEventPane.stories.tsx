import type { CalendarDescriptor, CalendarEventData } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarEventPane } from "./CalendarEventPane";

/**
 * The calendar's reading pane, at the three states the routes below the view
 * can put it in: the event, one occurrence of a repeating one, and an address
 * naming an event the calendar does not have on screen.
 */
const calendar: CalendarDescriptor = {
	id: "cal_work",
	accountId: "acct_work",
	accountLabel: "Work",
	name: "Northwind",
	color: "cal-1",
};

const event: CalendarEventData = {
	id: "evt_roadmap",
	calendarId: calendar.id,
	title: "Roadmap review",
	start: "2026-06-10T10:00:00+02:00",
	end: "2026-06-10T11:30:00+02:00",
	allDay: false,
	location: "Room Zuid",
	notes: "Bring the staffing numbers.",
	attendees: [
		{
			name: "Priya Natarajan",
			email: "priya@northwind.example",
			rsvp: "accepted",
			role: "organizer",
		},
	],
	myRsvp: "accepted",
	threadId: "",
	threadSubject: "",
	timeZone: "Europe/Amsterdam",
	zoneCertainty: "explicit",
	recurrenceRule: "",
	seriesId: "",
	seriesException: false,
	status: "confirmed",
};

const meta: Meta<typeof CalendarEventPane> = {
	title: "App/Calendar/Event pane",
	component: CalendarEventPane,
	parameters: { layout: "fullscreen" },
	args: {
		event,
		calendar,
		isOccurrence: false,
		problem: "",
		onEdit: () => {},
		onDelete: () => {},
		onClose: () => {},
	},
	render: (args) => (
		<div className="h-dvh max-w-xl border-l border-line bg-canvas">
			<CalendarEventPane {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof CalendarEventPane>;

export const Event: Story = {};

/** The series is what the address names; the occurrence is the segment below. */
export const Occurrence: Story = {
	args: {
		event: {
			...event,
			title: "Standup",
			start: "2026-06-11T09:15:00+02:00",
			end: "2026-06-11T09:30:00+02:00",
			recurrenceRule: "Every weekday, 09:15",
			seriesId: "ser_standup",
		},
		isOccurrence: true,
	},
};

/** An old link, or a week the event is not in. Never a blank pane. */
export const NotOnThisWeek: Story = {
	args: { event: undefined, calendar: undefined },
};

/**
 * The event was replaced somewhere else — over CalDAV, or in another tab —
 * between it being read and the write going out. Nothing was overwritten, and
 * the pane says so where the reader is looking rather than anywhere else.
 */
export const ChangedElsewhere: Story = {
	args: {
		problem:
			"This event changed somewhere else — over CalDAV, or in another tab. Nothing was saved. Close it and open it again to see the version that's stored now.",
	},
};

/**
 * The resource has not been read yet, so there is no version to write against.
 * The controls stay off until there is: a write with no etag is one that can
 * quietly overwrite somebody.
 */
export const NotWritableYet: Story = {
	args: { onEdit: undefined, onDelete: undefined },
};
