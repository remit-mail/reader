import type { Meta, StoryObj } from "@storybook/react";
import { AutoMovedBadge } from "./auto-moved-badge.js";

const meta: Meta<typeof AutoMovedBadge> = {
	title: "Mail/AutoMovedBadge",
	component: AutoMovedBadge,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof AutoMovedBadge>;

export const WithUndo: Story = {
	args: {
		label: "Moved from Junk by Remit",
		onUndo: () => alert("Undo"),
	},
};

export const MovedToJunk: Story = {
	args: {
		label: "Moved from Inbox by Remit",
		onUndo: () => alert("Undo"),
	},
};

export const WithoutUndoAction: Story = {
	args: { label: "Moved from Junk by Remit" },
};

export const FilterMoveWithManageLink: Story = {
	args: {
		label: "Moved from Inbox by Remit",
		onUndo: () => alert("Undo"),
		filtersHref: "/settings/filters",
	},
};

/**
 * A user-reported spam message (issue #648). Independent of the classifier/
 * filter-move shapes above: the badge follows the message wherever it now
 * lives, including a report that never moved the message at all (it was
 * already in Junk).
 */
export const ReportedAsSpam: Story = {
	args: {
		label: "Reported as spam",
		onUndo: () => alert("Undo"),
	},
};

export const SideBySide: Story = {
	render: () => (
		<div className="flex flex-col items-start gap-3">
			<AutoMovedBadge label="Moved from Junk by Remit" />
			<AutoMovedBadge
				label="Moved from Junk by Remit"
				onUndo={() => undefined}
			/>
			<AutoMovedBadge
				label="Moved from Inbox by Remit"
				onUndo={() => undefined}
				filtersHref="/settings/filters"
			/>
		</div>
	),
};
