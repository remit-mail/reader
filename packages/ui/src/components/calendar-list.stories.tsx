import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CalendarList } from "./calendar-list.js";
import type { CalendarDescriptor } from "./calendar-types.js";

/**
 * The legend and the filter are the same control, and it never leaves the
 * screen. Hiding it in a popover would mean reading a coloured grid with the
 * key in another room.
 */
const meta: Meta<typeof CalendarList> = {
	title: "Calendar/Calendar list",
	component: CalendarList,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="max-w-60 rounded-lg border border-line bg-surface py-2">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof CalendarList>;

const calendars: CalendarDescriptor[] = [
	{
		id: "c1",
		accountId: "a1",
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-1",
	},
	{
		id: "c2",
		accountId: "a1",
		accountLabel: "Work",
		name: "On-call",
		color: "cal-4",
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
	{
		id: "c5",
		accountId: "a2",
		accountLabel: "Personal",
		name: "Travel",
		color: "cal-6",
	},
	{
		id: "c6",
		accountId: "a3",
		accountLabel: "Synthwave Forum",
		name: "Synth meetups",
		color: "cal-5",
	},
];

/** Ticking a calendar off is a first-class move, so it takes one click. */
export const Interactive: Story = {
	render: () => {
		const [visible, setVisible] = useState(
			new Set(calendars.map((c) => c.id).filter((id) => id !== "c2")),
		);
		return (
			<CalendarList
				calendars={calendars}
				visible={visible}
				onToggle={(id) =>
					setVisible((prev) => {
						const next = new Set(prev);
						if (!next.delete(id)) next.add(id);
						return next;
					})
				}
				onToggleAccount={(accountId, nextVisible) =>
					setVisible((prev) => {
						const next = new Set(prev);
						for (const calendar of calendars) {
							if (calendar.accountId !== accountId) continue;
							if (nextVisible) next.add(calendar.id);
							else next.delete(calendar.id);
						}
						return next;
					})
				}
			/>
		);
	},
};

/** Everything off: an unticked calendar keeps its swatch outline, so the key survives. */
export const AllHidden: Story = {
	render: () => (
		<CalendarList
			calendars={calendars}
			visible={new Set()}
			onToggle={() => {}}
		/>
	),
};
