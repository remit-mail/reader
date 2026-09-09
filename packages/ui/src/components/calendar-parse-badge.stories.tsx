import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	CalendarParseBadge,
	calendarParseNote,
} from "./calendar-parse-badge.js";
import type { CalendarParseMethod } from "./calendar-types.js";

/**
 * Which rung of the ladder answered. The difference between a field the sender
 * stated and a reading of their prose decides how hard the reader has to check,
 * so the badge says which one it was.
 */
const meta: Meta<typeof CalendarParseBadge> = {
	title: "Calendar/Parse badge",
	component: CalendarParseBadge,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof CalendarParseBadge>;

const methods: CalendarParseMethod[] = ["ics", "markup", "pattern"];

/** The whole ladder at once, each with the note that belongs to it. */
export const EveryRung: Story = {
	render: () => (
		<div className="flex max-w-md flex-col gap-3">
			{methods.map((method) => (
				<div key={method} className="flex flex-col gap-1">
					<CalendarParseBadge method={method} className="self-start" />
					<p className="text-xs text-fg-muted">{calendarParseNote[method]}</p>
				</div>
			))}
		</div>
	),
};

/** An attached invitation: the sender's own fields, copied. */
export const AttachedInvitation: Story = {
	args: { method: "ics" },
};

/** A reading of the prose, which is the rung that can be wrong. */
export const ReadFromTheWords: Story = {
	args: { method: "pattern" },
};
