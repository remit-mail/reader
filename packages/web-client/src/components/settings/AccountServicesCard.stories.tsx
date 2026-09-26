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
		refusal: null,
		onRequestChange: () => {},
	},
};
export default meta;

type Story = StoryObj<typeof AccountServicesCard>;

export const MailOnly: Story = {};

export const BothOn: Story = { args: { enabled: ["Mail", "Calendar"] } };

export const CalendarRefused: Story = {
	args: {
		refusal: {
			service: "Calendar",
			intent: "on",
			message:
				"This account's Microsoft consent does not cover Calendar. Grant it through POST /accounts/oauth/microsoft/start.",
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
