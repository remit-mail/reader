import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings } from "lucide-react";
import { BugReportButton } from "./BugReportButton";

const meta: Meta<typeof BugReportButton> = {
	title: "Playground/Shipped/Mail/Nav/BugReportButton",
	component: BugReportButton,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof BugReportButton>;

export const Default: Story = {
	render: () => (
		<div className="w-64">
			<BugReportButton />
		</div>
	),
};

export const InDrawerFooter: Story = {
	render: () => (
		<div className="w-64 space-y-0.5 border-t border-line bg-canvas p-2">
			<button
				type="button"
				className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
			>
				<Settings className="size-4 shrink-0" />
				<span className="flex-1 truncate text-left">Settings</span>
			</button>
			<BugReportButton />
		</div>
	),
};
