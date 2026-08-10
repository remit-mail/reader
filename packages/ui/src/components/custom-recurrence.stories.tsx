import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	type CustomRecurrence,
	defaultCustomRecurrence,
	defaultEndDate,
	formatCustomRecurrence,
} from "../lib/recurrence.js";
import { CustomRecurrenceEditor } from "./custom-recurrence.js";

const DATE = "2026-06-09";
const START = "09:15";

/**
 * The rule the derived choices cannot express. Every part of it is a control —
 * how often, which days, when it stops — and what comes out is the same
 * sentence the picker reads back. Nobody types an RRULE and nobody is shown
 * one; the line under each story is what the event would carry.
 */
const meta: Meta<typeof CustomRecurrenceEditor> = {
	title: "Calendar/Custom recurrence",
	component: CustomRecurrenceEditor,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof CustomRecurrenceEditor>;

function Editor({ seed, touch }: { seed: CustomRecurrence; touch?: boolean }) {
	const [rule, setRule] = useState(seed);
	return (
		<div className="flex max-w-sm flex-col gap-4 rounded-lg border border-line bg-surface p-5">
			<h3 className="text-lg font-semibold text-fg">Custom recurrence</h3>
			<CustomRecurrenceEditor
				value={rule}
				onChange={setRule}
				date={DATE}
				suggestedEndDate={defaultEndDate(DATE)}
				touch={touch}
			/>
			<p className="border-t border-line pt-3 text-sm text-fg-muted">
				{formatCustomRecurrence(rule, DATE, START)}
			</p>
		</div>
	);
}

/** What it opens as: every week, on the day the event already sits on. */
export const Weekly: Story = {
	render: () => <Editor seed={defaultCustomRecurrence(DATE)} />,
};

/**
 * Two days a week, fortnightly, until October. None of that is expressible as
 * a choice derived from a date, which is the whole reason this exists.
 */
export const EveryOtherWeekUntilOctober: Story = {
	name: "Every other week, until October",
	render: () => (
		<Editor
			seed={{
				interval: 2,
				unit: "week",
				weekdays: [1, 4],
				monthlyMode: "dayOfMonth",
				ends: { kind: "onDate", date: "2026-10-03" },
			}}
		/>
	),
};

/**
 * A monthly rule means two different things about the same date — the ninth,
 * or the second Tuesday — and which one is meant is never derivable. So it is
 * asked rather than assumed.
 */
export const MonthlyReadTwoWays: Story = {
	name: "Monthly, read two ways",
	render: () => (
		<Editor
			seed={{
				...defaultCustomRecurrence(DATE),
				unit: "month",
				monthlyMode: "weekdayOfMonth",
			}}
		/>
	),
};

/** An ending counted rather than dated: thirteen times and then it stops. */
export const EndsAfterCount: Story = {
	name: "Ends after a count",
	render: () => (
		<Editor
			seed={{
				...defaultCustomRecurrence(DATE),
				ends: { kind: "afterCount", count: 13 },
			}}
		/>
	),
};

/** The same controls at thumb size, as the phone step renders them. */
export const Touch: Story = {
	render: () => <Editor seed={defaultCustomRecurrence(DATE)} touch />,
};
