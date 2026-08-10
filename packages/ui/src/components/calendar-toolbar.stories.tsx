import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
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
};
