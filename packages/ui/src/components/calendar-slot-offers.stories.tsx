import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CalendarSlotOffers } from "./calendar-slot-offers.js";
import type { CalendarSlotPick } from "./calendar-types.js";

/**
 * The day's free gaps as things to hand back, not as a grid to read off.
 * Picking one is not a booking: it goes into a reply as plain text.
 */
const meta: Meta<typeof CalendarSlotOffers> = {
	title: "Calendar/Slot offers",
	component: CalendarSlotOffers,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof CalendarSlotOffers>;

const THURSDAY = "2026-06-11";

function slot(startTime: string, endTime: string): CalendarSlotPick {
	return { date: THURSDAY, startTime, endTime, allDay: false };
}

const thursday: CalendarSlotPick[] = [
	slot("10:45", "11:15"),
	slot("11:30", "12:00"),
	slot("12:00", "12:30"),
	slot("15:15", "15:45"),
	slot("16:00", "16:30"),
];

function Offering({ touch, scroll }: { touch?: boolean; scroll?: boolean }) {
	const [picked, setPicked] = useState<string[]>(["11:30"]);
	return (
		<div className="max-w-sm">
			<CalendarSlotOffers
				slots={thursday}
				picked={new Set(picked)}
				onToggle={(slotPick) =>
					setPicked((prev) =>
						prev.includes(slotPick.startTime)
							? prev.filter((start) => start !== slotPick.startTime)
							: [...prev, slotPick.startTime],
					)
				}
				touch={touch}
				scroll={scroll}
			/>
			<p className="mt-2 text-2xs text-fg-subtle">
				{picked.length} would go into the reply. Nothing is booked.
			</p>
		</div>
	);
}

/** The wrapping block, which is what a mouse gets. */
export const Wrapping: Story = {
	render: () => <Offering />,
};

/** A scrolling rail instead, for a panel too narrow to wrap into. */
export const Scrolling: Story = {
	render: () => <Offering scroll />,
};

/** Thumb-sized targets, which is the only difference touch makes. */
export const Touch: Story = {
	render: () => <Offering touch />,
};

/** A day with no gap at this length says so rather than drawing an empty row. */
export const NothingFree: Story = {
	args: {
		slots: [],
		picked: new Set<string>(),
		onToggle: () => undefined,
	},
};
