import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDetailsForm } from "./CalendarDetailsForm";

/**
 * Settings › Calendars: one calendar's name and zone, and deleting it. Every
 * state the server can leave the form in, including its refusal to delete the
 * default calendar.
 */
const meta: Meta<typeof CalendarDetailsForm> = {
	title: "Playground/Shipped/Settings/Calendars/Calendar details",
	component: CalendarDetailsForm,
	parameters: { layout: "padded" },
	args: {
		calendarName: "Work",
		timezone: "Europe/Amsterdam",
		isBusy: false,
		problem: "",
		onSave: () => undefined,
		onDelete: () => undefined,
	},
	render: (args) => (
		<div className="max-w-xl">
			<CalendarDetailsForm {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof CalendarDetailsForm>;

export const Default: Story = {};

/** No zone of its own, which reads as UTC. */
export const Unzoned: Story = { args: { timezone: "" } };

/** A save or delete is out; every control waits. */
export const Busy: Story = { args: { isBusy: true } };

/** The server refused to delete the default calendar, in its own words. */
export const DeleteRefused: Story = {
	args: {
		calendarName: "Default",
		problem:
			'"default" is the calendar this account files events into and cannot be removed',
	},
};

/** Deleting asks first, because every event in the calendar goes with it. */
export const DeleteConfirm: Story = {
	play: async ({ canvasElement }) => {
		const buttons = [...canvasElement.querySelectorAll("button")];
		buttons.find((button) => button.textContent === "Delete calendar")?.click();
	},
};

/** The same form on the dark theme. */
export const Dark: Story = { parameters: { theme: "dark" } };
