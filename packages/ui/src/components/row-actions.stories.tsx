import type { Meta, StoryObj } from "@storybook/react";
import { RotateCcw, Send, Trash2 } from "lucide-react";
import { RowActions } from "./row-actions.js";

const meta: Meta<typeof RowActions> = {
	title: "Primitives/RowActions",
	component: RowActions,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof RowActions>;

export const SecondaryWithDestructiveConfirm: Story = {
	name: "Secondary + destructive confirm",
	args: {
		actions: [{ label: "Manage", onClick: () => undefined }],
		destructive: {
			label: "Delete",
			icon: <Trash2 className="size-3.5" />,
			iconOnly: true,
			onClick: () => undefined,
			confirm: {
				prompt: "Delete this account?",
				confirmLabel: "Delete account",
			},
		},
	},
};

export const Reconnect: Story = {
	args: {
		actions: [
			{ label: "Reconnect", variant: "secondary", onClick: () => undefined },
		],
		destructive: {
			label: "Delete",
			icon: <Trash2 className="size-3.5" />,
			iconOnly: true,
			onClick: () => undefined,
			confirm: {
				prompt: "Delete this account?",
				confirmLabel: "Delete account",
			},
		},
	},
};

export const Reconnecting: Story = {
	args: {
		actions: [
			{
				label: "Reconnect",
				variant: "secondary",
				busy: true,
				busyLabel: "Redirecting…",
				onClick: () => undefined,
			},
		],
	},
};

export const OutboxFailedRow: Story = {
	name: "Outbox — failed row",
	args: {
		actions: [
			{
				label: "Retry sending",
				icon: <RotateCcw className="size-3.5" />,
				iconOnly: true,
				onClick: () => undefined,
			},
			{
				label: "Edit as draft",
				icon: <Send className="size-3.5" />,
				iconOnly: true,
				onClick: () => undefined,
			},
		],
		destructive: {
			label: "Delete message",
			icon: <Trash2 className="size-3.5" />,
			iconOnly: true,
			onClick: () => undefined,
		},
	},
};
