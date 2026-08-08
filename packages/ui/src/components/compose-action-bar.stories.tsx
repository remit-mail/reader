import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { ComposeActionBar } from "./compose-action-bar.js";

/**
 * Send, Discard, and what the draft is doing. Send is never greyed out and
 * never silent: a state that cannot send carries the sentence that says why,
 * and the press reports it.
 */
const meta: Meta<typeof ComposeActionBar> = {
	title: "Mail/ComposeActionBar",
	component: ComposeActionBar,
	parameters: { layout: "padded" },
	args: {
		send: { status: "ready" },
		onSend: fn(),
		onBlocked: fn(),
		onDiscard: fn(),
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
	args: { send: { status: "sending" } },
};

export const NoRecipient: Story = {
	name: "Blocked — nobody to send to",
	args: {
		send: { status: "blocked", reason: "Add at least one recipient." },
	},
	play: async ({ args, canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Send" }),
		);
		await expect(args.onBlocked).toHaveBeenCalledWith(
			"Add at least one recipient.",
		);
		await expect(args.onSend).not.toHaveBeenCalled();
	},
};

export const SmtpMissing: Story = {
	name: "Blocked — the account cannot send",
	args: {
		send: {
			status: "blocked",
			reason: "This account can't send mail until SMTP is configured.",
		},
	},
};
