import type { Meta, StoryObj } from "@storybook/react";
import { ComposeActionBar } from "./compose-action-bar.js";

const meta: Meta<typeof ComposeActionBar> = {
	title: "Mail/ComposeActionBar",
	component: ComposeActionBar,
	parameters: { layout: "padded" },
	args: {
		onSend: () => undefined,
		onDiscard: () => undefined,
		sending: false,
		canSend: true,
		saveStatus: "idle",
	},
};
export default meta;

type Story = StoryObj<typeof ComposeActionBar>;

export const Ready: Story = {};

export const Saving: Story = { args: { saveStatus: "saving" } };

export const Saved: Story = { args: { saveStatus: "saved" } };

export const SaveFailed: Story = { args: { saveStatus: "error" } };

export const Sending: Story = {
	name: "Sending — also while the pending draft is written",
	args: { sending: true },
};

export const CannotSend: Story = {
	name: "Cannot send — stays pressable",
	args: {
		canSend: false,
		unavailableReason: "SMTP not configured",
		onUnavailable: () => undefined,
	},
};
