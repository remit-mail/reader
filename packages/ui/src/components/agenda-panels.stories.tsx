import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	buildCalendarDay,
	type FreeStretch,
	freeAhead,
	readNextUp,
} from "../lib/agenda-time.js";
import {
	AgendaDensityControl,
	FreeTimeList,
	NextUpCard,
	PositionMap,
} from "./agenda-panels.js";
import type {
	CalendarDescriptor,
	CalendarEventData,
} from "./calendar-types.js";

/**
 * The readings beside the strip. None of them repeats the list — each answers
 * something the rows cannot answer at a glance.
 */
const meta: Meta = {
	title: "Calendar/Agenda panels",
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

const TODAY = "2026-06-10";
const NOW = `${TODAY}T09:15:00+02:00`;
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
	location = "",
): CalendarEventData {
	return {
		id,
		calendarId,
		title,
		start: `${date}T${from}:00${OFFSET}`,
		end: `${date}T${to}:00${OFFSET}`,
		allDay: false,
		location,
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
	};
}

const events = [
	event("evt_standup", "Standup", "work", TODAY, "09:00", "09:30"),
	event(
		"evt_roadmap",
		"Q3 roadmap review",
		"work",
		TODAY,
		"10:00",
		"11:30",
		"Kaap",
	),
	event("evt_lunch", "Lunch with Jane", "personal", TODAY, "12:30", "13:30"),
	event("evt_retro", "Retro", "work", TODAY, "16:00", "17:00"),
	event("evt_dentist", "Dentist", "personal", "2026-06-11", "14:00", "14:45"),
];

const dates = [
	"2026-06-10",
	"2026-06-11",
	"2026-06-12",
	"2026-06-13",
	"2026-06-14",
];
const days = dates.map((date) => buildCalendarDay(date, events, TODAY));
const dayOf = (date: string) => buildCalendarDay(date, events, TODAY);

const nextUpProps = {
	calendars,
	today: TODAY,
	onSelectEvent: () => {},
	onGoTo: () => {},
};

/** Something is running and something is coming: both, in one sentence each. */
export const NextUpRunning: Story = {
	render: () => (
		<NextUpCard
			{...nextUpProps}
			nextUp={readNextUp(days, NOW)}
			className="max-w-80"
		/>
	),
};

/** The end of a day, where "nothing else" is the whole answer. */
export const NextUpDone: Story = {
	render: () => (
		<NextUpCard
			{...nextUpProps}
			nextUp={readNextUp(days, "2026-06-14T21:00:00+02:00")}
			className="max-w-80"
		/>
	),
};

/** Grown for a rail a thumb reaches. */
export const NextUpTouch: Story = {
	render: () => (
		<NextUpCard
			{...nextUpProps}
			nextUp={readNextUp(days, NOW)}
			touch
			className="max-w-80"
		/>
	),
};

/** Three readings, not two, and the control never leaves the screen. */
export const Density: Story = {
	render: () => {
		const [value, setValue] = useState<"dots" | "pills" | "detail">("pills");
		return (
			<div className="flex flex-col gap-4">
				<AgendaDensityControl value={value} onChange={setValue} />
				<AgendaDensityControl value={value} onChange={setValue} icons />
				<AgendaDensityControl value={value} onChange={setValue} touch icons />
			</div>
		);
	},
};

/** Empty time, listed like anything else that is on the calendar. */
export const OpenTime: Story = {
	render: () => (
		<div className="max-w-80">
			<FreeTimeList
				stretches={freeAhead(days, NOW, 5)}
				today={TODAY}
				onPick={() => {}}
			/>
		</div>
	),
};

/** Nothing open is a sentence, never an empty box. */
export const NoOpenTime: Story = {
	render: () => (
		<div className="max-w-80">
			<FreeTimeList
				stretches={[] as FreeStretch[]}
				today={TODAY}
				onPick={() => {}}
			/>
		</div>
	),
};

/** A scrollbar with meaning: how full each day is, and where you are parked. */
export const WhereYouAre: Story = {
	render: () => {
		const [visible, setVisible] = useState("2026-06-11");
		return (
			<div className="max-w-64">
				<PositionMap
					anchorDate={TODAY}
					visibleDate={visible}
					today={TODAY}
					dayOf={dayOf}
					onGoTo={setVisible}
				/>
			</div>
		);
	},
};
