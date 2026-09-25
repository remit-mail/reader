import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CalendarSubscribeCard } from "./CalendarSubscribeCard";

/**
 * Settings › Calendars: subscribing to another calendar's read-only iCal
 * address (#1261). The server reads the feed before creating anything, so a
 * refusal means nothing was added.
 */
const meta: Meta<typeof CalendarSubscribeCard> = {
	title: "Flows/Settings Calendars/Subscribe to a calendar",
	component: CalendarSubscribeCard,
	parameters: { layout: "padded" },
	args: {
		isBusy: false,
		error: undefined,
		onSubscribe: fn(),
	},
};
export default meta;

type Story = StoryObj<typeof CalendarSubscribeCard>;

/** Empty: the button waits for a name and an address. */
export const Empty: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("button", { name: "Subscribe" }),
		).toBeDisabled();
	},
};

/** Filled in and sent. */
export const Filled: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByLabelText("Calendar name"),
			"Harbour rota",
		);
		await userEvent.type(
			canvas.getByLabelText("Calendar address"),
			"webcal://calendar.example/harbour/basic.ics",
		);
		await userEvent.click(canvas.getByRole("button", { name: "Subscribe" }));
		await expect(args.onSubscribe).toHaveBeenCalledWith(
			{
				displayName: "Harbour rota",
				url: "webcal://calendar.example/harbour/basic.ics",
			},
			expect.any(Function),
		);
	},
};

/** The feed is being read. */
export const Subscribing: Story = {
	args: { isBusy: true },
};

/** The feed could not be read, so no calendar was made. */
export const Refused: Story = {
	args: {
		error: {
			code: "subscription_unreachable",
			message: "the calendar was not created: the feed answered HTTP 404",
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"The calendar was not added.",
		);
	},
};

/** Refused, on the dark theme. */
export const RefusedDark: Story = {
	name: "Refused (dark)",
	parameters: { theme: "dark" },
	args: {
		error: {
			code: "subscription_unreachable",
			message:
				"the calendar was not created: the feed could not be reached (ENOTFOUND)",
		},
	},
};
