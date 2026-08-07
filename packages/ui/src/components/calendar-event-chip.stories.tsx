import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarEventChip } from "./calendar-event-chip.js";
import { calendarColorIds } from "./calendar-types.js";

/**
 * The event as it appears wherever the event's element is ours: an agenda, a
 * picker, a day column we draw ourselves. Colour says which calendar; shape and
 * mark say everything else, so an event never depends on hue alone to be read.
 *
 * Option A's grid is FullCalendar, which renders the element itself and accepts
 * only a class string and the content inside it, so that one surface restates
 * this shell rather than mounting the component. The two are held to the same
 * values — hue, the dashed box for a provisional event, the dimming for a
 * declined one, the mark size. What the grid cannot take from here is the
 * element: no `aria-pressed`, no focus ring of ours, and a column too short for
 * the second line this chip puts its marks on.
 */
const meta: Meta<typeof CalendarEventChip> = {
	title: "Calendar/Event chip",
	component: CalendarEventChip,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof CalendarEventChip>;

const base = {
	title: "Q3 roadmap review",
	timeText: "10:00",
	color: "cal-1",
	layout: "row",
	density: "comfortable",
	rsvp: "accepted",
	status: "confirmed",
	hasThread: false,
	isRecurring: false,
	zoneCertainty: "local",
	selected: false,
} as const;

/** The six calendar hues side by side, which is the only test that matters. */
export const EveryCalendarColour: Story = {
	render: () => (
		<div className="flex max-w-sm flex-col gap-1">
			{calendarColorIds.map((color, index) => (
				<CalendarEventChip
					key={color}
					{...base}
					color={color}
					title={`Calendar ${index + 1}`}
				/>
			))}
		</div>
	),
};

/** Every state the chip carries, in the order it degrades. */
export const States: Story = {
	render: () => (
		<div className="flex max-w-sm flex-col gap-1">
			<CalendarEventChip {...base} />
			<CalendarEventChip {...base} title="Staff screen" status="tentative" />
			<CalendarEventChip {...base} title="Vendor call" rsvp="declined" />
			<CalendarEventChip
				{...base}
				title="Standup"
				isRecurring
				hasThread={false}
			/>
			<CalendarEventChip {...base} title="Incident review" hasThread />
			<CalendarEventChip
				{...base}
				title="Offsite dinner"
				timeText="19:00"
				zoneCertainty="ambiguous"
			/>
			<CalendarEventChip {...base} title="Demo" selected />
		</div>
	),
};

/** In a time grid the chip fills its slot; the rail keeps the hue readable. */
export const ColumnLayout: Story = {
	render: () => (
		<div className="flex h-40 gap-1">
			<CalendarEventChip {...base} layout="column" color="cal-1" />
			<CalendarEventChip
				{...base}
				layout="column"
				color="cal-3"
				title="Design crit"
				timeText="10:15"
			/>
			<CalendarEventChip
				{...base}
				layout="column"
				color="cal-4"
				title="Vendor call"
				timeText="10:45"
				rsvp="declined"
			/>
		</div>
	),
};

/** Tighter density drops the chip to the smallest size that still reads. */
export const Compact: Story = {
	render: () => (
		<div className="flex max-w-sm flex-col gap-0.5">
			<CalendarEventChip {...base} density="compact" />
			<CalendarEventChip
				{...base}
				density="compact"
				color="cal-2"
				title="Lunch walk"
				timeText="12:30"
				hasThread
			/>
			<CalendarEventChip
				{...base}
				density="compact"
				color="cal-5"
				title="Modular jam"
				timeText="20:00"
			/>
		</div>
	),
};
