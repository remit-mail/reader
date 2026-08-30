import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
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

/**
 * An account folded shut. Its calendars are still on the grid — the caret hides
 * rows, the tick hides events, and the two are not the same thing.
 */
export const AccountFolded: Story = {
	render: () => (
		<CalendarList
			calendars={calendars}
			visible={new Set(calendars.map((c) => c.id))}
			onToggle={() => {}}
			onToggleAccount={() => {}}
			closedAccountIds={["a2"]}
		/>
	),
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
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const box of canvas.getAllByRole("checkbox")) {
			await expect(box).not.toBeChecked();
		}
		await expect(canvas.getByText("Travel")).toBeVisible();
	},
};

/**
 * One account with one calendar in it, which is what a new install looks like.
 * The control is still the legend, so it stays on screen: a grid whose single
 * colour is unexplained is no more readable than one with six.
 */
export const SingleCalendar: Story = {
	render: () => {
		const only = calendars.slice(0, 1);
		const [visible, setVisible] = useState(new Set([only[0].id]));
		return (
			<CalendarList
				calendars={only}
				visible={visible}
				onToggle={(id) =>
					setVisible((prev) => {
						const next = new Set(prev);
						if (!next.delete(id)) next.add(id);
						return next;
					})
				}
			/>
		);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const northwind = canvas.getByRole("checkbox", { name: "Northwind" });
		await expect(northwind).toBeChecked();
		await userEvent.click(canvas.getByText("Northwind"));
		await expect(northwind).not.toBeChecked();
	},
};

/**
 * The same control on a surface with no room for a rail: a scrolling row of
 * chips at thumb size. It is laid out differently and it is not a popover —
 * turning a calendar off stays one press away from the grid.
 */
export const AsAStrip: Story = {
	render: () => {
		const [visible, setVisible] = useState(new Set(calendars.map((c) => c.id)));
		return (
			<CalendarList
				calendars={calendars}
				layout="strip"
				touch
				visible={visible}
				onToggle={(id) =>
					setVisible((prev) => {
						const next = new Set(prev);
						if (!next.delete(id)) next.add(id);
						return next;
					})
				}
			/>
		);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getAllByRole("checkbox")).toHaveLength(
			calendars.length,
		);
		const onCall = canvas.getByRole("checkbox", { name: "On-call" });
		await userEvent.click(canvas.getByText("On-call"));
		await expect(onCall).not.toBeChecked();
		await expect(
			canvas.getByRole("checkbox", { name: "Northwind" }),
		).toBeChecked();
	},
};
