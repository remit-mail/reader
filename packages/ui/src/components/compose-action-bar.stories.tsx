import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
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

/**
 * Send is never greyed out. Pressing it with nobody to send to reports the
 * reason where the app would raise its banner — a control that swallowed the
 * press would be the dead button this bar exists to avoid.
 */
export const NoRecipient: Story = {
	name: "Blocked — nobody to send to",
	args: {
		send: { status: "blocked", reason: "Add at least one recipient." },
	},
	render: (args) => {
		const [reason, setReason] = useState<string>();
		return (
			<div className="space-y-2">
				{reason && (
					<div
						role="alert"
						data-testid="compose-unavailable"
						className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
					>
						{reason}
					</div>
				)}
				<ComposeActionBar
					{...args}
					onBlocked={(next) => {
						args.onBlocked(next);
						setReason(next);
					}}
				/>
			</div>
		);
	},
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Send" }));
		await expect(canvas.getByTestId("compose-unavailable")).toHaveTextContent(
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

export const StillLoading: Story = {
	name: "Blocked — the body has not arrived",
	args: {
		send: { status: "blocked", reason: "The message is still loading." },
	},
};
