import type { Meta, StoryObj } from "@storybook/react-vite";
import { SelectionToolbar } from "./SelectionToolbar";

/**
 * The desktop bulk-action bar. It keeps its bounded verbs (mark-read, move,
 * delete, organize) and, from issue #212, gains the search-escalation states
 * the mobile `SelectionSheet` already carries: the "Select all N matching…"
 * offer, a running count, the escalated predicate, a chunked run's progress,
 * and a partial-failure Retry. Both surfaces read the same derivations in
 * `MessageList`, so these stories and the kit `SelectionTopBar` stories track
 * the one state matrix.
 *
 * The Move verb needs the account-scoped `MoveToTrigger` (its own query and
 * folder data), so it is left out here to keep these stories provider-free —
 * its visual is covered by the kit `SelectionTopBar` stories' move slot. The
 * escalated stories below still assert verb parity through the mark-read and
 * delete verbs remaining available over the predicate.
 */
const meta: Meta<typeof SelectionToolbar> = {
	title: "Screens/WebClient/SelectionToolbar",
	component: SelectionToolbar,
	parameters: { layout: "padded" },
	args: {
		selectedCount: 3,
		onDelete: () => undefined,
		onClearSelection: () => undefined,
		onMarkAsRead: () => undefined,
	},
	render: (args) => (
		<div className="w-full rounded-md border border-line">
			<SelectionToolbar {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof SelectionToolbar>;

/** A plain bounded selection: the count in words, mark-read and delete. */
export const Bounded: Story = {};

export const OneSelected: Story = { args: { selectedCount: 1 } };

/**
 * Some but not all loaded rows checked while searching: the select-all control
 * renders the tri-state dash.
 */
export const SelectAllIndeterminate: Story = {
	args: {
		selectAll: {
			checked: false,
			indeterminate: true,
			onChange: () => undefined,
		},
	},
};

/**
 * Every loaded row checked. The label names the loaded scope — "All 47 loaded
 * selected" — rather than a bare count next to a fully ticked box.
 */
export const AllLoadedSelected: Story = {
	args: {
		selectedCount: 47,
		selectAll: { checked: true, onChange: () => undefined },
	},
};

/**
 * Search has more matches than are loaded: an escalation offer naming the
 * scope (a real button, not prose). Tapping it pays for the real count.
 */
export const EscalationAvailable: Story = {
	args: {
		selectedCount: 47,
		selectAll: { checked: true, onChange: () => undefined },
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

/**
 * The result set is still paging to its total: a running count, Delete hidden
 * (the count it would act on isn't known yet), and an explicit Stop.
 */
export const Counting: Story = {
	args: {
		selectedCount: 47,
		isCounting: true,
		statusLabel: "Counting… 1,900 so far",
		selectAll: { checked: true, onChange: () => undefined },
		notice: {
			tone: "info",
			text: "",
			action: { label: "Stop", onClick: () => undefined },
		},
	},
};

/** Past ~10s the counting state says so rather than looking stuck. */
export const CountingLargeResultSet: Story = {
	args: {
		selectedCount: 0,
		isCounting: true,
		statusLabel: "Counting… 12,400 so far. This is a big result set.",
		notice: {
			tone: "info",
			text: "",
			action: { label: "Stop", onClick: () => undefined },
		},
	},
};

/**
 * The selection is now the search predicate: the count names the query's total,
 * every verb stays available over it (#114 — not delete-only), and the notice
 * offers a way back to the bounded selection.
 */
export const Escalated: Story = {
	args: {
		selectedCount: 3412,
		statusLabel: 'All 3,412 matching "npm" selected',
		notice: {
			tone: "info",
			text: "",
			action: { label: "Clear selection", onClick: () => undefined },
		},
	},
};

/**
 * A chunked delete over the predicate: a running total and a determinate
 * progress bar, the verbs off screen (the bar is the only thing that can act
 * mid-run), toned as destructive.
 */
export const DeletingWithProgress: Story = {
	args: {
		selectedCount: 3412,
		statusLabel: "Deleting 1,200 of 3,412…",
		progress: { value: 1200, max: 3412, tone: "danger" },
	},
};

/** A move over the escalated selection: the same run, toned as ordinary
 *  progress and worded for the action that is running. */
export const MovingWithProgress: Story = {
	args: {
		selectedCount: 3412,
		statusLabel: "Moving 1,200 of 3,412…",
		progress: { value: 1200, max: 3412, tone: "info" },
	},
};

/** Mark-read over the escalated selection. */
export const MarkingReadWithProgress: Story = {
	args: {
		selectedCount: 3412,
		statusLabel: "Marking 1,200 of 3,412 as read…",
		progress: { value: 1200, max: 3412, tone: "info" },
	},
};

/**
 * A run left some messages unreached: the notice names how many landed, the
 * count reflects only what is still selected (the failures), and Retry targets
 * exactly that.
 */
export const PartialFailure: Story = {
	args: {
		selectedCount: 340,
		notice: {
			tone: "danger",
			text: "3,072 moved to Trash. 340 couldn't be deleted.",
			action: { label: "Retry 340", onClick: () => undefined },
		},
	},
};

/**
 * A selection spanning accounts: Move is withdrawn (it only works within one
 * account) and the reason is stated inline.
 */
export const CrossAccountHint: Story = {
	args: {
		moveDisabledHint:
			"Move only works within one account — clear selection or pick messages from a single account",
	},
};
