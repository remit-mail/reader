import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderInput } from "lucide-react";
import { SelectionSheet } from "./selection-sheet.js";

const meta: Meta<typeof SelectionSheet> = {
	title: "Screens/Kit/SelectionSheet",
	component: SelectionSheet,
	parameters: { layout: "fullscreen" },
	args: {
		count: 3,
		onCancel: () => undefined,
		onDelete: () => undefined,
		onMarkRead: () => undefined,
		onJunk: () => undefined,
		onSelectSimilar: () => undefined,
		onSomethingElse: () => undefined,
	},
	decorators: [
		(Story) => (
			<div className="relative mx-auto h-dvh w-full shrink-0 overflow-hidden bg-surface sm:my-6 sm:h-[720px] sm:w-[390px] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-sm">
				{/* Inbox backdrop, so the peeking sheet reads against a list. */}
				<div className="divide-y divide-line opacity-50">
					{Array.from({ length: 11 }).map((_, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
							key={i}
							className="flex items-start gap-3 px-row-inset py-2.5"
						>
							<div className="mt-0.5 size-7 shrink-0 rounded-full bg-surface-sunken" />
							<div className="min-w-0 flex-1 space-y-1">
								<div className="h-2.5 w-1/3 rounded bg-surface-sunken" />
								<div className="h-2 w-2/3 rounded bg-surface-sunken" />
							</div>
						</div>
					))}
				</div>
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof SelectionSheet>;

/** Stand-in for the caller's move-to-folder trigger (an icon button that opens
 *  a folder picker). The sheet only reserves the slot. */
const MoveSlot = () => (
	<button
		type="button"
		aria-label="Move selected messages"
		className="inline-flex size-11 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-raised"
	>
		<FolderInput className="size-4" />
	</button>
);

/** Collapsed — the slim ~56px teaser that rises at 2+ selected. */
export const Teaser: Story = {
	args: { moveSlot: <MoveSlot /> },
};

/** Expanded — quick actions (Delete / Move / Junk) plus the select-similar and
 *  "Something else" entries. */
export const Expanded: Story = {
	args: { startExpanded: true, moveSlot: <MoveSlot /> },
};

/** While a search result set pages to its total: the count isn't known, the
 *  quick actions are replaced by the running total and an explicit Stop. */
export const Counting: Story = {
	args: {
		count: 0,
		mode: "counting",
		startExpanded: true,
		statusLabel: "Counting… 1,900 so far",
		selectAll: {
			checked: true,
			indeterminate: false,
			onChange: () => undefined,
		},
		notice: {
			tone: "info",
			text: "",
			action: { label: "Stop", onClick: () => undefined },
		},
	},
};

/** A bulk delete in progress — a running total and a determinate progress bar,
 *  the delete busy, no quick actions to act mid-run. */
export const RunningProgress: Story = {
	args: {
		count: 3412,
		mode: "running",
		startExpanded: true,
		isBusy: true,
		statusLabel: "Deleting 1,200 of 3,412…",
		progress: { value: 1200, max: 3412 },
	},
};

/**
 * Every loaded row checked and the search has more matches: the sheet offers to
 * escalate the selection to the whole result set.
 */
export const EscalationAvailable: Story = {
	args: {
		count: 47,
		startExpanded: true,
		moveSlot: <MoveSlot />,
		selectAll: {
			checked: true,
			indeterminate: false,
			onChange: () => undefined,
		},
		notice: {
			tone: "info",
			text: "",
			action: {
				label: 'Select all matching "npm"',
				onClick: () => undefined,
			},
		},
	},
};

/** Selection escalated to the search predicate: the count names the query's
 *  total, every verb still acts, and the notice offers a way back. */
export const Escalated: Story = {
	args: {
		count: 3412,
		mode: "escalated",
		startExpanded: true,
		moveSlot: <MoveSlot />,
		statusLabel: 'All 3,412 matching "npm" selected',
		notice: {
			tone: "info",
			text: "",
			action: { label: "Clear selection", onClick: () => undefined },
		},
	},
};

/** After a bulk delete with some batches failed: the count reflects only what
 *  is still selected — the failures — and Retry names how many. */
export const PartialFailure: Story = {
	args: {
		count: 340,
		startExpanded: true,
		moveSlot: <MoveSlot />,
		notice: {
			tone: "danger",
			text: "3,072 moved to Trash. 340 couldn't be deleted.",
			action: { label: "Retry 340", onClick: () => undefined },
		},
	},
};
