import type { Meta, StoryObj } from "@storybook/react";
import { AutoMovedBadge } from "./auto-moved-badge.js";

const meta: Meta<typeof AutoMovedBadge> = {
	title: "Mail/AutoMovedBadge",
	component: AutoMovedBadge,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof AutoMovedBadge>;

export const ListRow: Story = {
	args: { label: "Moved from Junk by Remit", size: "sm" },
};

export const ReadingViewWithUndo: Story = {
	args: {
		label: "Moved from Junk by Remit",
		size: "md",
		onUndo: () => alert("Undo"),
	},
};

export const MovedToJunk: Story = {
	args: {
		label: "Moved from Inbox by Remit",
		size: "md",
		onUndo: () => alert("Undo"),
	},
};

export const WithoutUndoAction: Story = {
	args: { label: "Moved from Junk by Remit", size: "md" },
};

export const FilterMoveWithManageLink: Story = {
	args: {
		label: "Moved from Inbox by Remit",
		size: "md",
		onUndo: () => alert("Undo"),
		filtersHref: "/settings/filters",
	},
};

export const FilterMoveListRow: Story = {
	args: {
		label: "Moved from Inbox by Remit",
		size: "sm",
		filtersHref: "/settings/filters",
	},
};

export const SideBySide: Story = {
	render: () => (
		<div className="flex flex-col items-start gap-3">
			<AutoMovedBadge label="Moved from Junk by Remit" size="sm" />
			<AutoMovedBadge
				label="Moved from Junk by Remit"
				size="md"
				onUndo={() => undefined}
			/>
			<AutoMovedBadge
				label="Moved from Inbox by Remit"
				size="md"
				onUndo={() => undefined}
				filtersHref="/settings/filters"
			/>
		</div>
	),
};
