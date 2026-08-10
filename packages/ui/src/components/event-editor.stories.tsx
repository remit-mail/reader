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

function Live({ startExpanded }: { startExpanded: boolean }) {
	const [draft, setDraft] = useState(seed);
	const [expanded, setExpanded] = useState(startExpanded);
	return (
		<div className="max-w-sm rounded-lg border border-line bg-surface-raised p-4">
			<EventEditor
				draft={draft}
				onChange={setDraft}
				calendars={calendars}
				expanded={expanded}
				onToggleExpanded={() => setExpanded((open) => !open)}
				onSave={() => {}}
				onCancel={() => {}}
			/>
		</div>
	);
}

export const Folded: Story = { render: () => <Live startExpanded={false} /> };

/** Everything the folded form was hiding. */
export const Unfolded: Story = { render: () => <Live startExpanded /> };

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
