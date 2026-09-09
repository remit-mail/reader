import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AccountServiceChangeDialog } from "./account-service-change-dialog.js";

/**
 * The question between a service switch and the change it asks for (#1179).
 * Every state of it is copy, so every state is a story.
 */
const meta: Meta<typeof AccountServiceChangeDialog> = {
	title: "Components/AccountServiceChangeDialog",
	component: AccountServiceChangeDialog,
	parameters: { layout: "fullscreen" },
	args: {
		providerName: "Microsoft",
		onConfirm: () => undefined,
		onCancel: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof AccountServiceChangeDialog>;

/**
 * Mail off. The confirmation is the only place the promise is made, so it makes
 * it in full: what stays, what stops, and that nothing is deleted.
 */
export const DisableMail: Story = {
	args: { change: { kind: "disable", service: "Mail" } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/Nothing is deleted/)).toBeVisible();
	},
};

/** Calendar off. The events already read in stay on the calendar. */
export const DisableCalendar: Story = {
	args: { change: { kind: "disable", service: "Calendar" } },
};

/**
 * Calendar on, for an account whose consent never covered it. The round trip is
 * named before the person commits, and nothing changes until they are back.
 */
export const EnableCalendar: Story = {
	args: { change: { kind: "enable", service: "Calendar" } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("button", { name: "Continue to Microsoft" }),
		).toBeVisible();
	},
};

/**
 * The switch that would leave the account syncing nothing. No stored account
 * holds the empty set, so this points at removing the account and says what
 * that costs — which is what switching a service off never does.
 */
export const LastService: Story = {
	args: { change: { kind: "last", service: "Mail" } },
};

/** Nothing pending: the dialog is absent, not an empty overlay. */
export const NothingPending: Story = {
	args: { change: null },
};
