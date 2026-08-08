import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { Density } from "./app-shell-types.js";
import {
	CalendarDateNav,
	CalendarDensityControl,
	CalendarViewSwitch,
} from "./calendar-toolbar.js";
import type { CalendarViewId } from "./calendar-types.js";

/**
 * The controls that sit above every calendar surface: the zoom ladder, the
 * density the reader picks, and one way home.
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

/** How much of a day fits is the reader's call on every view. */
export const DensityChoice: Story = {
	render: () => {
		const [density, setDensity] = useState<Density>("comfortable");
		return <CalendarDensityControl value={density} onChange={setDensity} />;
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
