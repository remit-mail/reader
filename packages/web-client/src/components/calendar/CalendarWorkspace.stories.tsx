import {
	type CalendarColorId,
	type CalendarEventData,
	type CalendarViewId,
	type Density,
	NavSidebar,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CalendarWorkspace } from "./CalendarWorkspace";

/**
 * The calendar pane the `/calendar/{view}/{date}` route mounts, at every state
 * the shipping shell can be in.
 *
 * It is presentational: the toolbar's moves leave through callbacks and the
 * route turns each one into an address, so a story can drive them with local
 * state and get the same surface the app renders. What the stories are for is
 * what the markup cannot answer — how a week reads once a day is full, and
 * whether a zoom that is not drawn yet reads as unfinished rather than empty.
 */
const TIME_ZONE = "Europe/Amsterdam";
const DATE = "2026-06-10";
const NOW = `${DATE}T09:30:00+02:00`;

const WORK = "cal_work";
const TEAM = "cal_team";
const HOME = "cal_home";

const colorByCalendarId: Record<string, CalendarColorId> = {
	[WORK]: "cal-1",
	[TEAM]: "cal-6",
	[HOME]: "cal-4",
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
	at("roadmap", "Roadmap review", "08", "11:00", "12:00", {
		calendarId: TEAM,
	}),
	at("standup-tue", "Standup", "09", "09:15", "09:30", {
		recurrenceRule: "Every weekday, 09:15",
		seriesId: "ser_standup",
	}),
	at("supplier", "Supplier call", "09", "14:00", "15:00", {
		calendarId: TEAM,
		zoneCertainty: "ambiguous",
	}),
	at("standup-wed", "Standup", "10", "09:15", "09:30", {
		recurrenceRule: "Every weekday, 09:15",
		seriesId: "ser_standup",
	}),
	at("design", "Design review", "10", "10:00", "12:00", {
		calendarId: TEAM,
	}),
	at("dentist", "Dentist", "10", "11:00", "12:00", {
		calendarId: HOME,
		location: "Kerkstraat 4",
	}),
	at("one-to-one", "One to one", "11", "15:00", "16:00"),
	at("retro", "Retro", "12", "16:00", "17:00", { calendarId: TEAM }),
	at("climbing", "Climbing", "13", "10:00", "12:00", { calendarId: HOME }),
];

/** The shell drives view and date through the router; a story drives its own. */
function Workspace({
	initialView,
	events,
	isLoading,
	error,
}: {
	initialView: CalendarViewId;
	events: CalendarEventData[];
	isLoading?: boolean;
	error?: unknown;
}) {
	const [view, setView] = useState<CalendarViewId>(initialView);
	const [density, setDensity] = useState<Density>("comfortable");
	const [selected, setSelected] = useState("");
	return (
		<CalendarWorkspace
			view={view}
			date={DATE}
			events={events}
			colorByCalendarId={colorByCalendarId}
			isLoading={isLoading}
			error={error}
			onRetry={() => undefined}
			density={density}
			selectedEventId={selected}
			timeZone={TIME_ZONE}
			now={NOW}
			onChangeView={setView}
			onToday={() => undefined}
			onStep={() => undefined}
			onChangeDensity={setDensity}
			onSelectEvent={setSelected}
			onPickSlot={() => undefined}
		/>
	);
}

const meta: Meta<typeof Workspace> = {
	title: "App/Calendar/Workspace",
	component: Workspace,
	parameters: { layout: "fullscreen" },
	args: { initialView: "week", events: week },
	render: (args) => (
		<div className="h-dvh bg-canvas">
			<Workspace {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof Workspace>;

export const Week: Story = {};

export const Day: Story = { args: { initialView: "day" } };

/** Nothing scheduled is still a grid, never a "nothing here" surface. */
export const EmptyWeek: Story = { args: { events: [] } };

/** The first read of a week, before the server has answered. */
export const Loading: Story = { args: { events: [], isLoading: true } };

/**
 * The read was refused. This is the state an empty grid must never be confused
 * with: a week drawn blank because the request failed reads as a week with
 * nothing in it, and the reader plans their day around it.
 */
export const CouldNotLoad: Story = {
	args: {
		events: [],
		error: new Error("The window has to be shorter than a year."),
	},
};

/**
 * The three zooms that are named but not drawn yet. Each says what it is
 * waiting on, so the route is addressable without pretending to be finished.
 */
export const YearNotBuiltYet: Story = { args: { initialView: "year" } };

export const MonthNotBuiltYet: Story = { args: { initialView: "month" } };

export const AgendaNotBuiltYet: Story = { args: { initialView: "agenda" } };

/**
 * The calendar beside the nav it is reached from. The entry sits under the
 * daily brief, which is where the shipping sidebar puts it.
 */
export const WithTheNav: Story = {
	render: (args) => (
		<div className="flex h-dvh bg-canvas">
			<div className="w-64 shrink-0">
				<NavSidebar
					accounts={[
						{
							id: "acct_work",
							label: "Work",
							email: "work@example.invalid",
							mailboxes: [
								{ id: "mb_inbox", name: "Inbox", role: "inbox", unseen: 3 },
								{ id: "mb_sent", name: "Sent", role: "sent" },
							],
						},
					]}
					selectedNavId="calendar"
					calendarNav="shown"
				/>
			</div>
			<div className="min-w-0 flex-1">
				<Workspace {...args} />
			</div>
		</div>
	),
};
