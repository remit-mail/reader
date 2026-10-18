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

/** A message failed to sync or was set aside: the dot on the way to settings. */
export const SyncWarnings: Story = {
	args: {
		show: true,
		label: "Sync warnings",
		children: <Settings className="size-4" />,
	},
};

/** The Warnings item in the settings nav carries the same dot. */
export const WarningsNavItem: Story = {
	args: {
		show: true,
		label: "Sync warnings",
		children: <TriangleAlert className="size-4" />,
	},
};

/** The list could not be read, so the dot stays lit and the page explains. */
export const ReadFailed: Story = {
	args: {
		show: true,
		label: "Warnings could not be read",
		children: <Settings className="size-4" />,
	},
};

/** An update is available. */
export const UpdateAvailable: Story = {
	args: {
		show: true,
		label: "Update available",
		children: <Wrench className="size-4" />,
	},
};

/** Nothing needs a look: the icon alone. */
export const Hidden: Story = {
	args: {
		show: false,
		label: "Sync warnings",
		children: <Settings className="size-4" />,
	},
};
