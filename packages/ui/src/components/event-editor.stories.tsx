import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { CalendarDescriptor, EventDraft } from "./calendar-types.js";
import { EventEditor } from "./event-editor.js";

/**
 * Three fields make an event. Location, guests, notes and repeat are real and
 * one click away, but they do not charge the common case for their existence.
 */
const meta: Meta<typeof EventEditor> = {
	title: "Calendar/Event editor",
	component: EventEditor,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof EventEditor>;

const calendars: CalendarDescriptor[] = [
	{
		id: "c1",
		accountId: "a1",
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-1",
	},
	{
		id: "c3",
		accountId: "a2",
		accountLabel: "Personal",
		name: "Personal",
		color: "cal-2",
	},
	{
		id: "c4",
		accountId: "a2",
		accountLabel: "Personal",
		name: "Family",
		color: "cal-3",
	},
];

const seed: EventDraft = {
	title: "",
	date: "2026-06-12",
	startTime: "13:00",
	endTime: "14:00",
	allDay: false,
	calendarId: "c1",
	location: "",
	guests: "",
	notes: "",
	repeat: "",
};

/** 23:00 to 01:00, which one date cannot hold. */
const backwards: EventDraft = {
	...seed,
	title: "Release window",
	startTime: "23:00",
	endTime: "01:00",
};

function Live({
	startExpanded,
	seed: initial = seed,
	guestsEditable,
	calendarEditable,
}: {
	startExpanded: boolean;
	seed?: EventDraft;
	guestsEditable?: boolean;
	calendarEditable?: boolean;
}) {
	const [draft, setDraft] = useState(initial);
	const [expanded, setExpanded] = useState(startExpanded);
	return (
		<div className="max-w-sm rounded-lg border border-line bg-surface-raised p-4">
			<EventEditor
				draft={draft}
				onChange={setDraft}
				calendars={calendars}
				expanded={expanded}
				onToggleExpanded={() => setExpanded((open) => !open)}
				guestsEditable={guestsEditable}
				calendarEditable={calendarEditable}
				onSave={() => {}}
				onCancel={() => {}}
			/>
		</div>
	);
}

export const Folded: Story = { render: () => <Live startExpanded={false} /> };

/** Everything the folded form was hiding. */
export const Unfolded: Story = { render: () => <Live startExpanded /> };

/**
 * An end before the start is one date read backwards, not a night that runs
 * over. The form keeps what was typed, names the problem under the fields and
 * holds the save until it is fixed.
 */
export const EndBeforeStart: Story = {
	render: () => <Live startExpanded={false} seed={backwards} />,
};

/**
 * Guests are opt-in. A store with nowhere to put them leaves the field out, so
 * the default form has none: a box that takes names and drops them is worse
 * than no box, because the reader only finds out later.
 */
export const WithGuests: Story = {
	render: () => <Live startExpanded guestsEditable />,
};

/**
 * Editing an event that already exists. The collection a resource lives in is
 * part of its address, so the calendar is read-only here rather than a picker
 * that changes nothing.
 */
export const WithoutTheCalendarPicker: Story = {
	render: () => <Live startExpanded calendarEditable={false} />,
};

/** All day takes the clock fields away, so there is no range left to reject. */
export const AllDay: Story = {
	render: () => (
		<Live startExpanded={false} seed={{ ...backwards, allDay: true }} />
	),
};

/** The same form sized for a bottom sheet: every control a thumb target. */
export const Touch: Story = {
	render: () => {
		const [draft, setDraft] = useState(seed);
		const [expanded, setExpanded] = useState(false);
		return (
			<div className="max-w-[390px] rounded-lg border border-line bg-surface-raised p-4">
				<EventEditor
					draft={draft}
					onChange={setDraft}
					calendars={calendars}
					expanded={expanded}
					onToggleExpanded={() => setExpanded((open) => !open)}
					onSave={() => {}}
					onCancel={() => {}}
					touch
				/>
			</div>
		);
	},
};
