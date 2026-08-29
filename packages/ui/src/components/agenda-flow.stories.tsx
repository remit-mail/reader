import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { buildCalendarDay, datesBetween } from "../lib/agenda-time.js";
import { AgendaFlow } from "./agenda-flow.js";
import type {
	CalendarDescriptor,
	CalendarEventData,
} from "./calendar-types.js";

/**
 * The strip spends its pixels on what is on the day rather than on the hours
 * the day contains. Every story here is a day the argument has to survive: a
 * pile-up, a day with nothing but a banner, and a week nobody booked.
 */
const meta: Meta<typeof AgendaFlow> = {
	title: "Calendar/Agenda flow",
	component: AgendaFlow,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="flex h-[38rem] flex-col border border-line bg-surface">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof AgendaFlow>;

const TODAY = "2026-06-10";
const OFFSET = "+02:00";

const calendars: CalendarDescriptor[] = [
	{
		id: "work",
		accountId: "a1",
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-1",
	},
	{
		id: "oncall",
		accountId: "a1",
		accountLabel: "Work",
		name: "On-call",
		color: "cal-4",
	},
	{
		id: "personal",
		accountId: "a2",
		accountLabel: "Personal",
		name: "Family",
		color: "cal-3",
	},
];

function event(
	id: string,
	title: string,
	calendarId: string,
	date: string,
	from: string,
	to: string,
	extra: Partial<CalendarEventData> = {},
): CalendarEventData {
	return {
		id,
		calendarId,
		title,
		start: `${date}T${from}:00${OFFSET}`,
		end: `${date}T${to}:00${OFFSET}`,
		allDay: false,
		location: "",
		notes: "",
		attendees: [],
		myRsvp: "accepted",
		threadId: "",
		threadSubject: "",
		timeZone: "Europe/Amsterdam",
		zoneCertainty: "explicit",
		recurrenceRule: "",
		seriesId: "",
		seriesException: false,
		status: "confirmed",
		...extra,
	};
}

const events: CalendarEventData[] = [
	event("evt_standup", "Standup", "work", TODAY, "09:00", "09:15", {
		recurrenceRule: "Every weekday",
	}),
	event("evt_roadmap", "Q3 roadmap review", "work", TODAY, "10:00", "11:30", {
		location: "Kaap",
		threadId: "thr_roadmap",
		attendees: [
			{
				name: "Anna Vos",
				email: "anna@example.test",
				rsvp: "accepted",
				role: "organizer",
			},
			{
				name: "Bram Peters",
				email: "bram@example.test",
				rsvp: "noReply",
				role: "attendee",
			},
		],
	}),
	event("evt_incident", "Incident review", "oncall", TODAY, "10:30", "12:00"),
	event("evt_1to1", "1:1 with Anna", "work", TODAY, "11:00", "11:20"),
	event("evt_lunch", "Lunch with Jane", "personal", TODAY, "12:30", "13:30", {
		location: "Toscanini",
	}),
	event("evt_retro", "Retro", "work", TODAY, "16:00", "17:00", {
		status: "tentative",
	}),
	event("evt_dentist", "Dentist", "personal", "2026-06-11", "14:00", "14:45", {
		myRsvp: "declined",
	}),
	event("evt_call", "Lisbon call", "work", "2026-06-11", "17:00", "18:00", {
		zoneCertainty: "ambiguous",
		timeZone: "",
	}),
	{
		...event("evt_devcon", "Devcon", "work", "2026-06-12", "00:00", "00:00"),
		start: "2026-06-12",
		end: "2026-06-13",
		allDay: true,
	},
	event("evt_offsite", "Offsite", "work", "2026-06-22", "09:00", "17:00"),
];

const days = datesBetween("2026-06-08", "2026-06-24").map((date) =>
	buildCalendarDay(date, events, TODAY),
);

const base = {
	days,
	calendars,
	today: TODAY,
	focusDate: TODAY,
	selectedEventId: "",
	onSelectEvent: () => {},
	onPickSlot: () => {},
	onZoomDay: () => {},
	onReachStart: () => {},
	onReachEnd: () => {},
	onVisibleDayChange: () => {},
};

/** The default reading: one row an event, free time drawn between them. */
export const Rows: Story = {
	args: { ...base, density: "pills" },
};

/** Where, who and which calendar, for a day you are actually working through. */
export const Detail: Story = {
	args: { ...base, density: "detail" },
};

/** A month at a glance: colour, load and one word a day. */
export const Dots: Story = {
	args: { ...base, density: "dots" },
};

/** A day with nothing on the clock says so instead of showing whitespace. */
export const ClearDay: Story = {
	args: { ...base, density: "pills", focusDate: "2026-06-13" },
};

/** Nine days nobody booked, as one sentence rather than nine screens. */
export const EmptyRun: Story = {
	args: { ...base, density: "pills", focusDate: "2026-06-18" },
};

/**
 * A year either way is as far as the strip grows on the scroll. Past that the
 * reader says so, rather than the strip fetching its way across a decade
 * because a sparse diary never fills the pane.
 */
export const AtTheCap: Story = {
	args: {
		...base,
		density: "pills",
		atStartCap: true,
		atEndCap: true,
		onLoadEarlier: () => {},
		onLoadLater: () => {},
	},
};

/** The selection is a state of the row, not a colour laid over it. */
export const Selected: Story = {
	args: { ...base, density: "detail", selectedEventId: "evt_roadmap" },
};

/** Every hit target grows where a finger has to find it. */
export const Touch: Story = {
	args: { ...base, density: "pills", touch: true },
};

/** What is next, landed on with today and scrolled away with it. */
export const WithTodayLead: Story = {
	args: {
		...base,
		density: "pills",
		todayLead: (
			<p className="border-b border-line bg-surface-sunken px-row-inset py-2 text-xs text-fg-muted">
				Next up · Q3 roadmap review in 30m
			</p>
		),
	},
};

/** Selecting a row is the only thing the strip owns; the owner holds the rest. */
export const Interactive: Story = {
	render: () => {
		const [selected, setSelected] = useState("");
		return (
			<AgendaFlow
				{...base}
				density="detail"
				selectedEventId={selected}
				onSelectEvent={setSelected}
			/>
		);
	},
};
