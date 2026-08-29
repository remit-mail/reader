import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CalendarGrid } from "./calendar-grid.js";
import type { CalendarColorId, CalendarEventData } from "./calendar-types.js";

/**
 * The grid, at every zoom it offers. It holds nothing: the events, the hues,
 * the day it is centred on and the clock it calls now all arrive as props, so a
 * story can put the marker on a Wednesday and keep it there.
 *
 * These are the states worth looking at rather than asserting: how far along a
 * column an overlap sits, and how a week reads once a day is full, are measured
 * in a browser and cannot be read off the markup.
 */
const TIME_ZONE = "Europe/Amsterdam";
const TODAY = "2026-06-10";
const NOW = `${TODAY}T09:30:00+02:00`;

const WORK = "cal_work";
const HOME = "cal_home";
const TEAM = "cal_team";

const colorByCalendarId: Record<string, CalendarColorId> = {
	[WORK]: "cal-1",
	[HOME]: "cal-4",
	[TEAM]: "cal-6",
};

const template: CalendarEventData = {
	id: "",
	calendarId: WORK,
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
	timeZone: TIME_ZONE,
	zoneCertainty: "explicit",
	recurrenceRule: "",
	seriesId: "",
	seriesException: false,
	status: "confirmed",
};

const at = (
	id: string,
	title: string,
	day: string,
	from: string,
	to: string,
	over: Partial<CalendarEventData> = {},
): CalendarEventData => ({
	...template,
	...over,
	id,
	title,
	start: `2026-06-${day}T${from}:00+02:00`,
	end: `2026-06-${day}T${to}:00+02:00`,
});

const week: CalendarEventData[] = [
	at("standup-mon", "Standup", "08", "09:15", "09:30", {
		recurrenceRule: "Every weekday, 09:15",
		seriesId: "ser_standup",
	}),
	at("supplier", "Supplier call", "08", "11:00", "12:00", {
		calendarId: TEAM,
		threadId: "th_supplier",
		zoneCertainty: "ambiguous",
	}),
	at("standup-tue", "Standup", "09", "09:15", "09:30", {
		recurrenceRule: "Every weekday, 09:15",
		seriesId: "ser_standup",
	}),
	at("review", "Design review", "09", "14:00", "15:30", { calendarId: TEAM }),
	at("standup-wed", "Standup", "10", "09:15", "09:30", {
		recurrenceRule: "Every weekday, 09:15",
		seriesId: "ser_standup",
	}),
	at("roadmap", "Roadmap review", "10", "10:00", "11:00"),
	at("dentist", "Dentist", "10", "10:30", "11:30", { calendarId: HOME }),
	at("retro", "Retro", "10", "10:45", "11:15", {
		calendarId: TEAM,
		status: "tentative",
	}),
	at("lunch", "Lunch with Ada", "10", "12:30", "13:30", { calendarId: HOME }),
	at("board", "Board prep", "11", "09:00", "10:30"),
	at("skipped", "All-hands", "11", "16:00", "17:00", { myRsvp: "declined" }),
	at("focus", "Focus block", "12", "09:00", "12:00", { calendarId: HOME }),
	{
		...template,
		id: "offsite",
		calendarId: TEAM,
		title: "Offsite",
		allDay: true,
		start: "2026-06-11",
		end: "2026-06-13",
	},
];

const meta: Meta<typeof CalendarGrid> = {
	title: "Calendar/Grid",
	component: CalendarGrid,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-screen bg-surface p-4">
				<Story />
			</div>
		),
	],
	args: {
		view: "week",
		date: TODAY,
		events: week,
		colorByCalendarId,
		density: "comfortable",
		selectedEventId: "",
		timeZone: TIME_ZONE,
		now: NOW,
		onSelectEvent: () => undefined,
		onPickSlot: () => undefined,
		onRangeChange: () => undefined,
	},
};
export default meta;
type Story = StoryObj<typeof CalendarGrid>;

export const Week: Story = {};

/** Three events running into each other on the same morning. */
export const Overlapping: Story = {
	args: {
		date: TODAY,
		events: week.filter((event) => event.start.startsWith("2026-06-10")),
	},
};

export const AllDayBand: Story = {
	args: { events: week.filter((event) => event.allDay) },
};

export const Day: Story = { args: { view: "day" } };

export const Month: Story = { args: { view: "month" } };

export const Year: Story = { args: { view: "year" } };

export const Agenda: Story = { args: { view: "agenda" } };

/** Halved slots, and the time comes off the chips that no longer fit it. */
export const Compact: Story = { args: { density: "compact" } };

export const Selected: Story = { args: { selectedEventId: "roadmap" } };

export const Empty: Story = { args: { events: [] } };

/** Nothing to list is a sentence, not a blank pane. */
export const AgendaEmpty: Story = { args: { view: "agenda", events: [] } };

/**
 * The clock is a prop, so the marker follows it: the same week, read on the
 * Friday instead.
 */
export const AnotherDayIsToday: Story = {
	args: { now: "2026-06-12T09:30:00+02:00" },
};

/** Clicking an event selects it; dragging a range reports the slot picked. */
export const Interactive: Story = {
	render: (args) => {
		const [selectedEventId, setSelected] = useState("");
		const [picked, setPicked] = useState("nothing yet");
		const [title, setTitle] = useState("");
		return (
			<div className="flex h-full flex-col gap-2">
				<p className="text-xs text-fg-muted">
					{title} — selected: {selectedEventId || "none"} — picked: {picked}
				</p>
				<div className="min-h-0 flex-1">
					<CalendarGrid
						{...args}
						selectedEventId={selectedEventId}
						onSelectEvent={setSelected}
						onPickSlot={(pick) =>
							setPicked(
								pick.allDay
									? `${pick.date}, all day`
									: `${pick.date} ${pick.startTime}–${pick.endTime}`,
							)
						}
						onRangeChange={setTitle}
					/>
				</div>
			</div>
		);
	},
};
