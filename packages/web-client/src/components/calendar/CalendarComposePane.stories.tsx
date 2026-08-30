import type { CalendarDescriptor, EventDraft } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CalendarComposePane } from "./CalendarComposePane";

/**
 * `/calendar/{view}/{date}/new`, and the same form reopened over an event being
 * edited.
 *
 * It holds no draft of its own, so a story drives it with local state and gets
 * the surface the app renders. What the stories are for is what the markup
 * cannot answer: whether a refusal reads as something to fix rather than as
 * something broken, and whether an edit scoped to one occurrence makes clear
 * that the rule is not up for changing.
 */
const calendars: CalendarDescriptor[] = [
	{
		id: "cal_work",
		accountId: "acct_work",
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-1",
	},
	{
		id: "cal_home",
		accountId: "acct_work",
		accountLabel: "Work",
		name: "Personal",
		color: "cal-4",
	},
];

const draft: EventDraft = {
	title: "Roadmap review",
	date: "2026-06-10",
	startTime: "10:00",
	endTime: "11:30",
	allDay: false,
	calendarId: "cal_work",
	location: "Room Zuid",
	guests: "",
	notes: "",
	repeat: "",
};

const meta: Meta<typeof CalendarComposePane> = {
	title: "App/Calendar/Compose pane",
	component: CalendarComposePane,
	parameters: { layout: "fullscreen" },
	args: {
		title: "New event",
		subtitle: "2026-06-10",
		calendars,
		draft,
		problem: "",
		saveLabel: "Add",
		isSaving: false,
		onSave: () => {},
		onCancel: () => {},
	},
	render: function Render(args) {
		const [current, setCurrent] = useState(args.draft);
		return (
			<div className="h-dvh max-w-2xl border-l border-line bg-canvas">
				<CalendarComposePane {...args} draft={current} onChange={setCurrent} />
			</div>
		);
	},
};
export default meta;

type Story = StoryObj<typeof CalendarComposePane>;

export const NewEvent: Story = {};

/** A refusal says what was wrong and what to do, where the reader is looking. */
export const Refused: Story = {
	args: {
		draft: { ...draft, title: "" },
		problem: "Give the event a title before saving it.",
	},
};

/** The write is out; the button says so rather than looking unpressed. */
export const Saving: Story = { args: { isSaving: true } };

/**
 * Editing one morning of a series. The rule belongs to the series, so it reads
 * back rather than offering itself for change.
 */
export const EditingOneOccurrence: Story = {
	args: {
		title: "Edit event",
		subtitle: "This occurrence only",
		saveLabel: "Save",
		repeatEditable: false,
		draft: {
			...draft,
			title: "Standup",
			startTime: "09:15",
			endTime: "09:30",
			repeat: "Every weekday, 09:15",
		},
	},
};

/** The version on screen was replaced elsewhere. Nothing is overwritten. */
export const Conflicted: Story = {
	args: {
		title: "Edit event",
		saveLabel: "Save",
		problem:
			"This event changed somewhere else — over CalDAV, or in another tab. Nothing was saved. Close it and open it again to see the version that's stored now.",
	},
};
