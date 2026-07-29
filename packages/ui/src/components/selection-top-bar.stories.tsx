import type { Meta, StoryObj } from "@storybook/react";
import { Menu, Search, Tag } from "lucide-react";
import { Button } from "./button.js";
import { PopoverMenu } from "./popover-menu.js";
import { SearchBar } from "./search-bar.js";
import { SelectionTopBar } from "./selection-top-bar.js";

const meta: Meta<typeof SelectionTopBar> = {
	title: "Screens/Kit/SelectionTopBar",
	component: SelectionTopBar,
	parameters: { layout: "padded" },
	args: {
		title: "Inbox",
		onCancel: () => undefined,
		onMarkRead: () => undefined,
		onJunk: () => undefined,
		onMove: () => undefined,
		onOrganize: () => undefined,
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

/** Stand-in for the caller's apply-label picker, whose list belongs to the
 *  account. A worded row, so it reads as one of the menu's actions. */
const LabelSlot = () => (
	<PopoverMenu
		triggerLabel="Apply label to selected messages"
		triggerIcon={<Tag className="size-4 text-fg-subtle" />}
		triggerText="Apply label"
		align="start"
		nested
		touch={false}
		triggerClassName="min-h-11 w-full justify-start gap-3 px-4 py-2.5 text-sm font-normal text-fg"
		items={[
			{ key: "work", label: "Work", onSelect: () => undefined },
			{ key: "receipts", label: "Receipts", onSelect: () => undefined },
		]}
	/>
);

const selectAll = {
	checked: false,
	indeterminate: true,
	onChange: () => undefined,
};

/** The list header's own chrome, which the bar carries while nothing is
 *  ticked. The live app builds these in `MailListHeader`. */
const chrome = {
	navSlot: (
		<Button
			variant="ghost"
			size="touch"
			icon={<Menu className="size-5" />}
			aria-label="Menu"
			className="-ml-2 shrink-0"
		/>
	),
	titleMeta: (
		<span className="shrink-0 text-2xs text-fg-subtle">15,338 unread</span>
	),
	searchSlot: (
		<Button
			variant="ghost"
			size="touch"
			icon={<Search className="size-5" />}
			aria-label="Search"
			className="shrink-0"
		/>
	),
};

/**
 * Nothing ticked: the surface is the list header and names the mailbox. From
 * 768px up the select-all control is already there — the same bar, one state
 * earlier, rather than a second surface that appears on the first tick.
 */
export const Idle: Story = {
	args: {
		...chrome,
		count: 0,
		selectAll: { checked: false, onChange: () => undefined },
	},
};

/** The same idle bar with search expanded over the title, which is what the
 *  tablet header does once a query is in play, and the make-filter row the
 *  search offers under it. */
export const IdleSearching: Story = {
	args: {
		...chrome,
		count: 0,
		selectAll: { checked: false, onChange: () => undefined },
		idleSlot: (
			<button
				type="button"
				className="flex min-h-11 w-full items-center px-row-inset text-left text-sm text-accent"
			>
				Make this a filter
			</button>
		),
		searchField: (
			<>
				<div className="min-w-0 flex-1">
					<SearchBar
						value="npm"
						onChange={() => undefined}
						onClear={() => undefined}
						globalFocusKey={false}
						showClearButton={false}
					/>
				</div>
				<Button
					variant="ghost"
					size="touch"
					icon={<Search className="size-5" />}
					aria-label="Close search"
					className="shrink-0"
				/>
			</>
		),
	},
};

/**
 * One ticked row. The count takes the title's place and the header's own
 * chrome stands down; the verbs arrive with it: Delete, Move and Organize
 * carry a glyph, Junk and Mark read live under the kebab. Every one of them
 * opens the wizard. Below 768px select-all takes a second row, so row one
 * stays a count and a
 * row of verbs with a back arrow out of selection.
 */
export const One: Story = {
	args: { ...chrome, count: 1, selectAll },
};

export const Many: Story = {
	args: { count: 3, selectAll },
};

/**
 * The overflow menu with the account's label picker at its foot. Labels carry
 * no verb on the bar (#477), so this is where applying one lives.
 */
export const WithLabelPicker: Story = {
	args: {
		count: 3,
		selectAll,
		overflowSlot: <LabelSlot />,
	},
};

/** A selection spanning folders or accounts has no move target and no
 *  account to file a rule under: the bar carries Delete and the overflow. */
export const WithoutMoveOrOrganize: Story = {
	args: { count: 2, onMove: undefined, onOrganize: undefined, selectAll },
};

/** A mutation in flight: Delete carries the spinner and every other verb
 *  stands down, because nothing else can act until it lands. */
export const Busy: Story = {
	args: { count: 2, isBusy: true, selectAll },
};

export const CrossAccountHint: Story = {
	args: {
		count: 4,
		selectAll,
		notice: {
			tone: "warning",
			text: "Move only works within one account — clear selection or pick messages from a single account",
		},
	},
};

/**
 * Every loaded row checked. The control now says what pressing it does, and
 * the count line names its scope by default — "All 47 loaded selected" —
 * instead of a bare "47 messages selected" next to a fully ticked box, which
 * reads as "everything" to anyone who has used a select-all checkbox before.
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
 * selection's identity from an id set to the search query (`useEscalatedActions`
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
 *
 * Every verb the bar carries stays available here (#114), and every one of
 * them opens the wizard, which names the predicate and states its count before
 * anything runs (#508). From the bar's side nothing changes, which is the
 * point: an escalated selection is a selection.
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
 * While the server is answering how many messages the search matches, the total
 * isn't on screen yet — the verbs are hidden (nothing to act on without it) and
 * Stop drops the escalation.
 */
export const Counting: Story = {
	args: {
		count: 0,
		isCounting: true,
		statusLabel: "Counting matches…",
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

/**
 * A bulk delete in progress reports a running total via `statusLabel` and a
 * determinate `ProgressBar`; the delete button shows its busy spinner (never
 * disables) and the overflow verbs drop out — nothing here can act mid-delete.
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
 * A move over an escalated selection: same chunked run as a delete, worded for
 * the action that is running and toned as ordinary progress rather than
 * destructive.
 */
export const MovingWithProgress: Story = {
	args: {
		count: 3412,
		statusLabel: "Moving 1,200 of 3,412…",
		isBusy: true,
		progress: { value: 1200, max: 3412, tone: "info" },
	},
};

/** Mark-read over the same escalated selection. */
export const MarkingReadWithProgress: Story = {
	args: {
		count: 3412,
		statusLabel: "Marking 1,200 of 3,412 as read…",
		isBusy: true,
		progress: { value: 1200, max: 3412, tone: "info" },
	},
};
