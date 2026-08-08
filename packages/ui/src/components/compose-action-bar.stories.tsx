import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
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

/**
 * Send is never greyed out. Pressing it with nothing to send on reports the
 * reason where the app would raise its banner — a control that swallowed the
 * press would be the dead button this bar exists to avoid.
 */
export const CannotSend: Story = {
	name: "Cannot send — stays pressable",
	render: () => {
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
					onSend={() => undefined}
					onDiscard={() => undefined}
					sending={false}
					canSend={false}
					saveStatus="idle"
					unavailableReason="SMTP not configured"
					onUnavailable={setReason}
				/>
			</div>
		);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Send" }));
		await expect(canvas.getByTestId("compose-unavailable")).toHaveTextContent(
			"SMTP not configured",
		);
	},
};
