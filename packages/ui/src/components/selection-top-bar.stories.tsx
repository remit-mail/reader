import type { Meta, StoryObj } from "@storybook/react";
import { SelectionTopBar } from "./selection-top-bar.js";

const meta: Meta<typeof SelectionTopBar> = {
	title: "Screens/Kit/SelectionTopBar",
	component: SelectionTopBar,
	parameters: { layout: "padded" },
	args: {
		onCancel: () => undefined,
		onMarkRead: () => undefined,
		onDelete: () => undefined,
	},
	render: (args) => (
		<div className="w-[390px] rounded-md border border-line">
			<SelectionTopBar {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof SelectionTopBar>;

export const One: Story = { args: { count: 1 } };

export const Many: Story = { args: { count: 3 } };

export const WithoutMarkRead: Story = {
	args: { count: 2, onMarkRead: undefined },
};

export const Busy: Story = { args: { count: 2, isBusy: true } };

export const CrossAccountHint: Story = {
	args: {
		count: 4,
		moveDisabledHint:
			"Move only works within one account — clear selection or pick messages from a single account",
	},
};

/** Some but not all rows checked: the select-all control renders the
 *  `Checkbox` tri-state dash, not the box or the tick. */
export const SelectAll: Story = {
	args: {
		count: 3,
		selectAll: {
			checked: false,
			indeterminate: true,
			onChange: () => undefined,
		},
	},
};

/** Every row checked: the select-all control renders as a plain checked box. */
export const AllSelected: Story = {
	args: {
		count: 12,
		selectAll: {
			checked: true,
			indeterminate: false,
			onChange: () => undefined,
		},
	},
};

/** While a search result set is still paging, the exact count isn't known yet —
 *  `statusLabel` replaces the "{count} selected" text with a counting message. */
export const Counting: Story = {
	args: {
		count: 0,
		statusLabel: "Counting matching messages…",
	},
};

/** A bulk delete in progress reports a running total via `statusLabel`, and
 *  the delete button shows its busy spinner (never disables). */
export const DeletingWithProgress: Story = {
	args: {
		count: 3412,
		statusLabel: "Deleting 1,200 of 3,412…",
		isBusy: true,
	},
};

/** After a bulk delete finishes with some batches failed, `failureHint`
 *  surfaces the shortfall in danger tone — independent of `moveDisabledHint`,
 *  which is muted and cross-account-specific. */
export const PartialFailure: Story = {
	args: {
		count: 3412,
		failureHint: "3,072 deleted, 340 failed to delete — retry?",
	},
};

/**
 * count === 0 is unreachable in production: both the kit
 * (`message-list-pane.tsx`'s `toggleCheck`) and the web-client
 * (`MessageList.tsx`'s multi-select effect) auto-exit selection mode the
 * instant the last checked row is unchecked. `SelectionTopBar` itself has no
 * floor on `count` — this story pins the contract that no caller should ever
 * leave it mounted here.
 */
export const ZeroSelected: Story = {
	args: { count: 0 },
};
