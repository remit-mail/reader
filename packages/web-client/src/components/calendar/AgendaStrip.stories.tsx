import {
	buildCalendarDay,
	type CalendarDescriptor,
	type CalendarEventData,
	type Density,
	datesBetween,
	freeStretchesOn,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { freeStretchesByDate } from "@/hooks/calendar";
import { AgendaStrip } from "./AgendaStrip";

/**
 * The agenda at every state the shipping strip can be in.
 *
 * It is presentational — the days it holds and the day it is anchored to are
 * the address's, and `AgendaView` turns each move here into one — so a story
 * drives it with local state and gets the surface the app renders. What the
 * stories answer is what the markup cannot: whether a fortnight with two things
 * in it reads as a fortnight rather than as a bug, and whether "your Thursday
 * afternoon is clear" survives being said about a calendar that is switched off.
 */

const TODAY = "2026-06-10";
const OFFSET = "+02:00";
const NOW = `${TODAY}T09:30:00${OFFSET}`;

const WORK = "cal_work";
const TEAM = "cal_team";
const HOME = "cal_home";

const calendars: CalendarDescriptor[] = [
	{
		id: WORK,
		accountId: "acct_work",
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-1",
	},
	{
		id: TEAM,
		accountId: "acct_work",
		accountLabel: "Work",
		name: "Platform",
		color: "cal-6",
	},
	{
		id: HOME,
		accountId: "acct_home",
		accountLabel: "Personal",
		name: "Home",
		color: "cal-4",
	},
];

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
	timeZone: "Europe/Amsterdam",
	zoneCertainty: "explicit",
	recurrenceRule: "",
	seriesId: "",
	seriesException: false,
	status: "confirmed",
};

const at = (
	id: string,
	title: string,
	date: string,
	from: string,
	to: string,
	over: Partial<CalendarEventData> = {},
): CalendarEventData => ({
	...template,
	...over,
	id,
	title,
	start: `${date}T${from}:00${OFFSET}`,
	end: `${date}T${to}:00${OFFSET}`,
});

/**
 * A fortnight that is mostly empty, which is what a real fortnight looks like.
 * Two busy days, a pile-up on one of them, and a long quiet run in the middle:
 * the shape the strip exists to draw and a time grid spends five screens on.
 */
const fortnight: CalendarEventData[] = [
	at("standup", "Standup", TODAY, "09:15", "09:30", {
		recurrenceRule: "Repeats",
		seriesId: "ser_standup",
	}),
	at("roadmap", "Q3 roadmap review", TODAY, "10:00", "11:30", {
		calendarId: TEAM,
		location: "Kaap",
	}),
	at("incident", "Incident review", TODAY, "10:30", "12:00"),
	at("dentist", "Dentist", "2026-06-11", "11:00", "12:00", {
		calendarId: HOME,
		location: "Kerkstraat 4",
	}),
	at("retro", "Retro", "2026-06-18", "16:00", "17:00", { calendarId: TEAM }),
	at("climbing", "Climbing", "2026-06-20", "10:00", "12:00", {
		calendarId: HOME,
	}),
];

/**
 * One day with an hour free in it and nothing else: what Detail is for, and the
 * reading a phone gets when the reader is actually in a day.
 */
const denseDay: CalendarEventData[] = [
	at("s", "Standup", TODAY, "09:00", "09:15"),
	at("d1", "Design review", TODAY, "09:30", "11:00", { calendarId: TEAM }),
	at("d2", "Supplier call", TODAY, "11:00", "12:00", { location: "Meet" }),
	at("d3", "One to one", TODAY, "13:30", "14:00", { location: "Room 2" }),
	at("d4", "Hiring panel", TODAY, "14:00", "15:30", { calendarId: TEAM }),
	at("d5", "Board prep", TODAY, "15:30", "17:00"),
	at("d6", "School run", TODAY, "17:00", "18:00", { calendarId: HOME }),
];

const dates = datesBetween("2026-06-01", "2026-06-24");

const pendingDates = (
	loading: "none" | "all" | "week",
): ReadonlySet<string> => {
	if (loading === "all") return new Set(dates);
	if (loading === "week")
		return new Set(datesBetween("2026-06-15", "2026-06-21"));
	return new Set();
};

/** The reader drives density; everything else is the address's in the app. */
function Strip({
	events,
	initialDensity,
	loading,
	error,
	busy,
	atCap,
}: {
	events: CalendarEventData[];
	initialDensity: Density;
	/** Which days have not answered: "all", "none", or one week of them. */
	loading: "none" | "all" | "week";
	error?: unknown;
	/** Busy time the strip is not drawing, as `/calendar-free-busy` returns it. */
	busy: { start: string; end: string }[];
	/** The run has grown as far as scrolling takes it, at one end or both. */
	atCap?: boolean;
}) {
	const [density] = useState<Density>(initialDensity);
	const [selected, setSelected] = useState("");
	const days = dates.map((date) => buildCalendarDay(date, events, TODAY));
	const measured = freeStretchesByDate(dates, busy);

	return (
		<AgendaStrip
			days={days}
			calendars={calendars}
			density={density}
			today={TODAY}
			anchorDate={TODAY}
			now={NOW}
			selectedEventId={selected}
			freeOn={(day) =>
				busy.length === 0
					? freeStretchesOn(day)
					: (measured.get(day.date) ?? freeStretchesOn(day))
			}
			loadingDates={pendingDates(loading)}
			error={error}
			onRetry={() => undefined}
			onSelectEvent={setSelected}
			onPickSlot={() => undefined}
			onZoomDay={() => undefined}
			onGoToDate={() => undefined}
			onReachStart={() => undefined}
			onReachEnd={() => undefined}
			atStartCap={atCap}
			atEndCap={atCap}
			onLoadEarlier={() => undefined}
			onLoadLater={() => undefined}
			onVisibleDayChange={() => undefined}
		/>
	);
}

const meta: Meta<typeof Strip> = {
	title: "App/Calendar/Agenda",
	component: Strip,
	parameters: { layout: "fullscreen" },
	args: {
		events: fortnight,
		initialDensity: "comfortable",
		loading: "none",
		busy: [],
	},
	render: (args) => (
		<div className="flex h-dvh flex-col bg-canvas">
			<Strip {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof Strip>;

/** A fortnight: two busy days, a pile-up, and the quiet in between named. */
export const PopulatedFortnight: Story = {};

/**
 * Before any week has answered. Every day is a skeleton on the date it will
 * occupy, so nothing jumps when the answers land — and, crucially, this does
 * not read as a fortnight with nothing booked.
 */
export const Loading: Story = { args: { loading: "all", events: [] } };

/** One week still in flight, with the answered days around it drawn. */
export const OneWeekStillLoading: Story = { args: { loading: "week" } };

/**
 * Nothing booked for weeks. The claim this view makes is that one sentence is a
 * better answer to "am I free" than a fortnight of blank screens.
 */
export const EmptyRunCollapsed: Story = { args: { events: [] } };

/** One day, back to back, at the reading that spends a row on each. */
export const DenseDay: Story = { args: { events: denseDay } };

/** The same dense day at Glance, where a title still has to be readable. */
export const DenseDayAtAGlance: Story = {
	args: { events: denseDay, initialDensity: "compact" },
};

/**
 * The reader has unticked the calendar those meetings are on, so the strip
 * draws nothing on the 11th. They are booked all the same, and the free bands
 * come from the merged busy spans rather than from the rows on screen.
 */
export const BusyOnACalendarNotDrawn: Story = {
	args: {
		events: [],
		busy: [
			{
				start: `2026-06-11T09:00:00${OFFSET}`,
				end: `2026-06-11T16:00:00${OFFSET}`,
			},
		],
	},
};

/**
 * The run has grown as far as scrolling takes it, and stops there rather than
 * fetching its way across years nobody asked for. A sparse diary draws shorter
 * than the distance the strip fetches at, so an end measured off the content
 * alone is reached on the first layout pass and never stops being reached —
 * which is why the cap says so and hands the reader the next stretch instead.
 */
export const AtTheCap: Story = {
	args: { atCap: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("button", { name: "Show earlier days" }),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Show later days" }),
		).toBeVisible();
	},
};

/** A read that was refused. An empty strip would say the opposite of this. */
export const CouldNotLoad: Story = {
	args: {
		events: [],
		error: new Error("The window has to be shorter than a year."),
	},
};
