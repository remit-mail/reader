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
	// Full viewport width — a fixed w-[390px] wrapper inside a 390px Storybook
	// viewport clipped the delete button off-screen in every story here.
	render: (args) => (
		<div className="w-full rounded-md border border-line">
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
		notice: {
			tone: "warning",
			text: "Move only works within one account — clear selection or pick messages from a single account",
		},
	},
};

/** Some but not all loaded rows checked: the select-all control renders the
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

/**
 * Every loaded row checked. The count line names its scope by default —
 * "All 47 loaded selected" — instead of a bare "47 messages selected" next
 * to a fully ticked box, which reads as "everything" to anyone who has used
 * a select-all checkbox before.
 */
export const AllSelected: Story = {
	args: {
		count: 47,
		selectAll: {
			checked: true,
			indeterminate: false,
			onChange: () => undefined,
		},
	},
};

/**
 * The search has more matches than are loaded: an escalation notice offers a
 * real button (not prose) naming the scope. Tapping it is what flips the
 * selection's identity from an id set to the search query (`useEscalatedDelete`
 * in web-client). No count in the label yet — the real client's own read path
 * (`ThreadOperations.searchThreads`) only counts within a capped recency
 * window short of paging the whole result set, and paging it just to seed a
 * button label the user hasn't asked for yet would burn a request on every
 * render of "all loaded selected" for a number that goes stale the moment new
 * mail arrives. Tapping the button is what pays for the real count, via the
 * counting state below.
 */
export const EscalationAvailable: Story = {
	args: {
		count: 47,
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

/**
 * Selection has been escalated to the search query: the count names the
 * query's total, not a materialized id count, and the notice offers a way
 * back to the bounded selection.
 */
export const Escalated: Story = {
	args: {
		count: 3412,
		statusLabel: 'All 3,412 matching "npm" selected',
		notice: {
			tone: "info",
			text: "",
			action: { label: "Clear selection", onClick: () => undefined },
		},
	},
};

/**
 * While a search result set is still paging, the exact count isn't known
 * yet — a running total instead of a static "Counting…", delete hidden
 * (nothing to act on with an unknown total), and an explicit Stop rather
 * than overloading the X (which still means "cancel selection").
 */
export const Counting: Story = {
	args: {
		count: 0,
		isCounting: true,
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

/** Past ~10s the counting state says so, rather than looking stuck. */
export const CountingLargeResultSet: Story = {
	args: {
		count: 0,
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
 * A bulk delete in progress reports a running total via `statusLabel` and a
 * determinate `ProgressBar`; the delete button shows its busy spinner (never
 * disables) and mark-read is hidden — nothing here can act mid-delete.
 */
export const DeletingWithProgress: Story = {
	args: {
		count: 3412,
		statusLabel: "Deleting 1,200 of 3,412…",
		isBusy: true,
		progress: { value: 1200, max: 3412 },
	},
};

/**
 * After a bulk delete finishes with some batches failed: the count reflects
 * only what's still selected — the failures — not the original selection,
 * and Retry is a real button naming how many.
 */
export const PartialFailure: Story = {
	args: {
		count: 340,
		notice: {
			tone: "danger",
			text: "3,072 moved to Trash. 340 couldn't be deleted.",
			action: { label: "Retry 340", onClick: () => undefined },
		},
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
