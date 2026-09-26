import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AccountServicesCard } from "./AccountServicesCard";

const meta: Meta<typeof AccountServicesCard> = {
	title: "Playground/Shipped/Settings/Accounts/What this account syncs",
	component: AccountServicesCard,
	parameters: { layout: "padded" },
	args: {
		providerName: "Microsoft",
		offered: ["Mail", "Calendar"],
		enabled: ["Mail"],
		consented: ["Mail", "Calendar"],
		disabled: false,
		refusal: null,
		onRequestChange: () => {},
	},
};
export default meta;

type Story = StoryObj<typeof AccountServicesCard>;

export const MailOnly: Story = {};

export const BothOn: Story = { args: { enabled: ["Mail", "Calendar"] } };

export const CalendarNeedsSignIn: Story = {
	args: { consented: ["Mail"] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText(/signing in with Microsoft again/),
		).toBeVisible();
	},
};

export const Saving: Story = {
	args: { enabled: ["Mail", "Calendar"], disabled: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("switch", { name: "Sync calendar" }),
		).toBeDisabled();
	},
};

export const CalendarRefused: Story = {
	args: {
		refusal: {
			service: "Calendar",
			intent: "on",
			message:
				"Couldn't open Microsoft's sign-in page. Check your connection, and anything blocking redirects, then try again.",
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("switch", { name: "Sync calendar" }),
		).not.toBeChecked();
		await expect(canvas.getByText("Couldn't turn calendar on")).toBeVisible();
		await expect(
			canvas.getByRole("link", { name: "Report an issue" }),
		).toBeVisible();
	},
};

export const Dark: Story = {
	...CalendarRefused,
	parameters: { theme: "dark" },
};
