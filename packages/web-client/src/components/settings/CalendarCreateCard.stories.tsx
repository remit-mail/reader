import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarCreateCard } from "./CalendarCreateCard";

/** Settings › Calendars: adding a calendar, and the server refusing one. */
const meta: Meta<typeof CalendarCreateCard> = {
	title: "Playground/Shipped/Settings/Calendars/New calendar",
	component: CalendarCreateCard,
	parameters: { layout: "padded" },
	args: {
		isBusy: false,
		problem: "",
		onCreate: () => Promise.resolve(true),
	},
};
export default meta;

type Story = StoryObj<typeof CalendarCreateCard>;

export const Empty: Story = {};

/** The create is out. */
export const Adding: Story = { args: { isBusy: true } };

/** The address is already taken, said in the server's words. */
export const AddressTaken: Story = {
	args: {
		problem:
			'"work" already addresses a calendar on this account — pick another',
	},
};

/** The same card on the dark theme. */
export const Dark: Story = { parameters: { theme: "dark" } };
