import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { CalendarDateNav, CalendarViewSwitch } from "./calendar-toolbar.js";
import type { CalendarViewId } from "./calendar-types.js";

/**
 * The controls that sit above every calendar surface: the zoom ladder and one
 * way home. The ladder is flat — the step you are on is marked by weight and
 * hue, the same way the nav marks the mailbox you are in.
 */
const meta: Meta = {
	title: "Calendar/Toolbar",
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

/** Year to day is one strip at four magnifications, not four screens. */
export const ViewLadder: Story = {
	render: () => {
		const [view, setView] = useState<CalendarViewId>("week");
		return (
			<div className="flex flex-col gap-3">
				<CalendarViewSwitch value={view} onChange={setView} />
				<CalendarViewSwitch
					value={view}
					onChange={setView}
					views={["day", "agenda"]}
					touch
				/>
				<p className="text-xs text-fg-muted">Showing: {view}</p>
			</div>
		);
	},
};

/** Today lands on the same target from every view and every distance. */
export const DateNav: Story = {
	render: () => {
		const [view, setView] = useState<CalendarViewId>("week");
		return (
			<div className="rounded-lg border border-line bg-surface p-2">
				<CalendarDateNav
					title="8 – 14 June 2026"
					onPrev={() => {}}
					onNext={() => {}}
					onToday={() => {}}
				>
					<CalendarViewSwitch value={view} onChange={setView} />
				</CalendarDateNav>
			</div>
		);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const name of ["Previous", "Next", "Today"]) {
			await expect(canvas.getByRole("button", { name })).toBeVisible();
		}
		await userEvent.click(canvas.getByRole("radio", { name: "Day" }));
		await expect(canvas.getByRole("radio", { name: "Day" })).toBeChecked();
	},
};

/**
 * The bar at a phone's width, where the whole ladder does not fit and a year
 * grid would be unreadable anyway. Back, forward and Today stay: they are how
 * the calendar is moved, and a toolbar that dropped them to make room would
 * leave the reader stuck on whatever week they opened on.
 */
export const OnAPhone: Story = {
	render: () => {
		const [view, setView] = useState<CalendarViewId>("day");
		return (
			<div className="w-[390px] rounded-lg border border-line bg-surface p-2">
				<CalendarDateNav
					title="Wed 10 June 2026"
					onPrev={() => {}}
					onNext={() => {}}
					onToday={() => {}}
					touch
				>
					<CalendarViewSwitch
						value={view}
						onChange={setView}
						views={["day", "agenda"]}
						touch
					/>
				</CalendarDateNav>
			</div>
		);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const name of ["Previous", "Next", "Today"]) {
			await expect(canvas.getByRole("button", { name })).toBeVisible();
		}
		await expect(canvas.queryByRole("radio", { name: "Y" })).toBeNull();
		await userEvent.click(canvas.getByRole("radio", { name: "List" }));
		await expect(canvas.getByRole("radio", { name: "List" })).toBeChecked();
	},
};

/**
 * A range whose name is longer than the room it has. The title gives way, not
 * the controls: it is the one thing on the bar that can be read off the grid
 * underneath it.
 */
export const LongRangeTitle: Story = {
	render: () => (
		<div className="w-[420px] rounded-lg border border-line bg-surface p-2">
			<CalendarDateNav
				title="29 December 2025 – 4 January 2026, week 1"
				onPrev={() => {}}
				onNext={() => {}}
				onToday={() => {}}
			>
				<CalendarViewSwitch value="week" onChange={() => {}} />
			</CalendarDateNav>
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("radio", { name: "Week" })).toBeChecked();
		await expect(canvas.getByRole("button", { name: "Today" })).toBeVisible();
	},
};
