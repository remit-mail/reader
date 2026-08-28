import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { AgendaComposer, AgendaPhraseField } from "./agenda-composer.js";
import type {
	AgendaParse,
	CalendarDescriptor,
	ChoicePicks,
	EventDraft,
} from "./calendar-types.js";

/**
 * Correcting the machine happens before the event exists. The sentence is read
 * back with the words each part came from, and where it has two honest
 * readings the composer asks rather than choosing.
 */
const meta: Meta<typeof AgendaComposer> = {
	title: "Calendar/Agenda composer",
	component: AgendaComposer,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="max-w-96">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof AgendaComposer>;

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

const draft: EventDraft = {
	title: "Lunch with Jane",
	date: "2026-06-12",
	startTime: "13:00",
	endTime: "14:00",
	allDay: false,
	calendarId: "work",
	location: "",
	guests: "Jane",
	notes: "",
	repeat: "",
};

const parse: AgendaParse = {
	title: "Lunch with Jane",
	date: "2026-06-12",
	dateText: "friday",
	startTime: "13:00",
	startTimeText: "1pm",
	endTime: "14:00",
	durationMinutes: 60,
	durationText: "",
	attendees: ["Jane"],
	attendeesText: "with Jane",
	location: "",
	locationText: "",
	repeat: "",
	repeatText: "",
	assumptions: ["An hour long, because the sentence never said."],
	unresolved: [],
	choices: [],
};

const repeating: AgendaParse = {
	...parse,
	title: "Standup",
	startTime: "09:30",
	endTime: "09:45",
	startTimeText: "9:30",
	dateText: "every weekday",
	repeat: "Every weekday",
	repeatText: "every weekday",
	attendees: [],
	attendeesText: "",
	assumptions: ["Fifteen minutes, because the sentence never said."],
};

const ambiguous: AgendaParse = {
	...parse,
	title: "Coffee with Marcus",
	startTime: "08:00",
	startTimeText: "at 8",
	endTime: "09:00",
	attendees: ["Marcus"],
	attendeesText: "with Marcus",
	unresolved: ["No place given."],
	choices: [
		{
			id: "which_eight",
			question: "Eight in the morning or eight at night?",
			source: "at 8",
			options: [
				{ id: "am", label: "08:00", date: "", startTime: "08:00" },
				{ id: "pm", label: "20:00", date: "", startTime: "20:00" },
			],
			chosenId: "am",
		},
	],
};

const base = {
	onPhraseChange: () => {},
	picks: {} as ChoicePicks,
	onPick: () => {},
	draft,
	onDraftChange: () => {},
	calendars,
	expanded: false,
	onToggleExpanded: () => {},
	onSave: () => {},
	onCancel: () => {},
	onOpen: () => {},
};

/** The field on its own — where the composer starts every time. */
export const FieldOnly: Story = {
	render: () => (
		<AgendaPhraseField
			phrase=""
			onPhraseChange={() => {}}
			onOpen={() => {}}
			onCommit={() => {}}
		/>
	),
};

/** A sentence that read cleanly, with the reading shown back above the form. */
export const Read: Story = {
	args: {
		...base,
		phrase: "lunch with Jane friday 1pm",
		parse,
		open: true,
	},
};

/** A rule the sentence carried, named as a rule rather than as one morning. */
export const Repeating: Story = {
	args: {
		...base,
		phrase: "standup every weekday 9:30",
		parse: repeating,
		draft: { ...draft, title: "Standup", repeat: "Every weekday" },
		open: true,
	},
};

/** Two honest readings: the question is a control, and the answer is one tap. */
export const Ambiguous: Story = {
	args: {
		...base,
		phrase: "coffee with Marcus at 8",
		parse: ambiguous,
		draft: { ...draft, title: "Coffee with Marcus", startTime: "08:00" },
		open: true,
	},
};

/** Folded away until there is something to correct. */
export const Folded: Story = {
	args: {
		...base,
		phrase: "lunch with Jane friday 1pm",
		parse,
		open: false,
	},
};

/** Grown for a phone, where the form is the whole screen. */
export const Touch: Story = {
	args: {
		...base,
		phrase: "coffee with Marcus at 8",
		parse: ambiguous,
		open: true,
		touch: true,
	},
};

/** Answering the question moves the reading; nothing is settled behind you. */
export const Interactive: Story = {
	render: () => {
		const [picks, setPicks] = useState<ChoicePicks>({});
		const [phrase, setPhrase] = useState("coffee with Marcus at 8");
		const [open, setOpen] = useState(true);
		const [expanded, setExpanded] = useState(false);
		const [current, setCurrent] = useState(draft);
		return (
			<AgendaComposer
				{...base}
				phrase={phrase}
				onPhraseChange={setPhrase}
				parse={ambiguous}
				picks={picks}
				onPick={(choiceId, optionId) =>
					setPicks((previous) => ({ ...previous, [choiceId]: optionId }))
				}
				draft={current}
				onDraftChange={setCurrent}
				expanded={expanded}
				onToggleExpanded={() => setExpanded((value) => !value)}
				open={open}
				onOpen={() => setOpen(true)}
			/>
		);
	},
};
