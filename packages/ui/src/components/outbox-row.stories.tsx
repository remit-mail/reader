import type { Meta, StoryObj } from "@storybook/react";
import { OutboxRow } from "./outbox-row.js";

const meta: Meta<typeof OutboxRow> = {
	title: "Mail/OutboxRow",
	component: OutboxRow,
	parameters: { layout: "padded" },
	args: {
		recipients: "alex@example.com +2",
		subject: "Q3 planning notes",
		time: "9:42",
		onSelect: () => undefined,
		onEdit: () => undefined,
		onDelete: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof OutboxRow>;

export const Queued: Story = { args: { status: "queued" } };

export const Sending: Story = { args: { status: "sending" } };

export const Sent: Story = { args: { status: "sent" } };

export const Failed: Story = {
	args: {
		status: "failed",
		error: "SMTP connection refused",
		onRetry: () => undefined,
	},
};

export const Blocked: Story = {
	args: {
		status: "blocked",
		error: "SMTP not configured for this account",
	},
};

export const Selected: Story = {
	args: { status: "queued", selected: true },
};

export const Empty: Story = {
	name: "Empty list",
	render: () => (
		<div className="flex h-32 items-center justify-center text-sm text-fg-muted">
			No outbox messages
		</div>
	),
};
