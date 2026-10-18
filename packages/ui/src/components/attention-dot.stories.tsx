import type { Meta, StoryObj } from "@storybook/react";
import { Settings, TriangleAlert, Wrench } from "lucide-react";
import { AttentionDot } from "./attention-dot.js";

const meta: Meta<typeof AttentionDot> = {
	title: "Design System/Settings/AttentionDot",
	component: AttentionDot,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof AttentionDot>;

export const SyncWarnings: Story = {
	args: {
		label: "Sync warnings",
		children: <Settings className="size-4" />,
	},
};

export const WarningsNavItem: Story = {
	args: {
		label: "Sync warnings",
		children: <TriangleAlert className="size-4" />,
	},
};

export const ReadFailed: Story = {
	args: {
		label: "Warnings could not be read",
		children: <Settings className="size-4" />,
	},
};

export const UpdateAvailable: Story = {
	args: {
		label: "Update available",
		children: <Wrench className="size-4" />,
	},
};

export const Hidden: Story = {
	args: {
		children: <Settings className="size-4" />,
	},
};
