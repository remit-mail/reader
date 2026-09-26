import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { ArrowLeft, Menu } from "lucide-react";
import { expect, within } from "storybook/test";
import { Button } from "./button.js";
import { PaneHeader } from "./pane-header.js";

const listPaneFrame: Decorator = (Story) => (
	<div
		className="overflow-hidden rounded-lg border border-line bg-canvas"
		style={{ width: 360 }}
	>
		<Story />
	</div>
);

const meta: Meta<typeof PaneHeader> = {
	title: "Design System/Mail/PaneHeader",
	component: PaneHeader,
	parameters: { layout: "centered" },
	decorators: [listPaneFrame],
	args: { title: "Outbox" },
};
export default meta;

type Story = StoryObj<typeof PaneHeader>;

export const Title: Story = {
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole("heading", { level: 1, name: "Outbox" }),
		).toBeVisible();
	},
};

export const WithMenuAndCount: Story = {
	args: {
		leading: (
			<Button
				variant="ghost"
				size="sm"
				aria-label="Menu"
				icon={<Menu className="size-4" />}
			/>
		),
		children: (
			<span className="shrink-0 text-2xs text-fg-subtle">3 messages</span>
		),
	},
};

export const BackOnly: Story = {
	args: {
		title: undefined,
		leading: (
			<Button
				variant="ghost"
				size="sm"
				icon={<ArrowLeft className="size-3.5" />}
			>
				Back to Inbox
			</Button>
		),
	},
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).queryByRole("heading")).toBeNull();
	},
};

export const Blank: Story = { args: { title: undefined } };

export const LongTitle: Story = {
	args: {
		title:
			"Consolidated quarterly reconciliation of the shared drive migration",
	},
};
