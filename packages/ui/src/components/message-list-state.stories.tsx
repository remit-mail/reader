import type { Decorator, Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import { inboxFilterConfig } from "../filter-presets.js";
import type { ThreadRowData } from "./app-shell-types.js";
import { FilterSheet } from "./filter-sheet.js";
import {
	MessageListEmpty,
	MessageListError,
	MessageListLoading,
	MessageListLoadingMore,
} from "./message-list-state.js";
import { ComfortableRow } from "./message-row.js";

const SENDERS = [
	"Alex Rivera",
	"Priya Raman",
	"Tom Okafor",
	"Lena Fischer",
] as const;

function makeRow(i: number): ThreadRowData {
	const fromName = SENDERS[i % SENDERS.length] ?? SENDERS[0];
	return {
		id: `t${i}`,
		accountId: "a1",
		fromName,
		fromEmail: `${fromName.split(" ")[0]?.toLowerCase()}@example.com`,
		subject: `Q3 planning notes ${i}`,
		snippet: "Pushed the deck to the shared drive — have a look before Friday.",
		timeLabel: `9:${String(i % 60).padStart(2, "0")}`,
		isRead: i % 3 === 0,
		category: "personal",
	};
}

const longRow: ThreadRowData = {
	...makeRow(1),
	fromName: "Netherlands Enterprise Agency, Subsidy and Permits Desk",
	subject:
		"Re: Re: Fwd: Consolidated quarterly reconciliation of the shared drive migration, including the appendices nobody asked for",
	snippet:
		"Following up on the earlier thread about the reconciliation, the appendices have been consolidated into a single document that now runs to sixty-two pages, and we would appreciate your review before the end of the week.",
};

const paneFrame: Decorator = (Story) => (
	<div className="h-screen w-96 overflow-hidden border border-line">
		<Story />
	</div>
);

/** The list body a filtered mailbox scrolls: rows plus whatever sits below them. */
function Rows({ count, rows }: { count?: number; rows?: ThreadRowData[] }) {
	const threads =
		rows ?? Array.from({ length: count ?? 6 }, (_, i) => makeRow(i + 1));
	return (
		<div className="divide-y divide-line">
			{threads.map((thread) => (
				<ComfortableRow key={thread.id} thread={thread} />
			))}
		</div>
	);
}

/**
 * The inbox behind its filter, collapsed. The filter's identity lives in this
 * summary bar (design D19 S5), which is why a filtered list needs no header of
 * its own to be told apart from the mailbox.
 */
function FilteredShell({
	category = "personal",
	children,
}: {
	category?: string;
	children: ReactNode;
}) {
	const preset = inboxFilterConfig();
	return (
		<div className="flex h-full flex-col">
			<FilterSheet
				categories={preset.categories}
				filters={preset.filters}
				selectedCategory={category}
				activeFilters={new Set<string>()}
				expanded={false}
				onSelectCategory={() => undefined}
				onToggleFilter={() => undefined}
				onClear={() => undefined}
				onExpandedChange={() => undefined}
			>
				<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
			</FilterSheet>
		</div>
	);
}

const meta: Meta<typeof MessageListEmpty> = {
	title: "Screens/Kit/MessageListState",
	component: MessageListEmpty,
	parameters: { layout: "centered" },
	decorators: [paneFrame],
};
export default meta;

type Story = StoryObj<typeof MessageListEmpty>;

/**
 * S1 — an empty mailbox with no filter. One plain line, no completeness claim:
 * nothing was narrowed, so there is nothing to reassure the reader about.
 */
export const EmptyMailbox: Story = {
	args: {},
};

/** S1 with a search query and no category filter — unchanged search copy. */
export const EmptyMailboxSearching: Story = {
	args: { searchQuery: "invoice" },
};

/**
 * A collection that is not a mailbox names itself. Flagged spans accounts, so
 * "this mailbox" was never true for it; its own states are #310.
 */
export const NamedCollectionEmpty: Story = {
	args: { scopeLabel: "Starred" },
};

/**
 * S2 — the state this slice exists for. The filter is active, the mailbox holds
 * no matching mail, and the list says the whole folder was checked so an empty
 * screen can no longer mean "we only looked at the newest page".
 */
export const FilteredEmpty: Story = {
	args: {
		filter: { label: "Personal", onClear: () => undefined },
		scopeLabel: "Inbox",
	},
	render: (args) => (
		<FilteredShell>
			<MessageListEmpty {...args} />
		</FilteredShell>
	),
};

/** S2 with a search query on top of the filter — same completeness sentence. */
export const FilteredEmptySearching: Story = {
	...FilteredEmpty,
	args: {
		filter: { label: "Personal", onClear: () => undefined },
		scopeLabel: "Inbox",
		searchQuery: "invoice",
	},
};

/**
 * The `Unclassified` chip's empty state. Unclassified mail is its own
 * filterable value and never reads as personal (issue #45), so this state is
 * reachable and distinct from `FilteredEmpty`.
 */
export const FilteredEmptyUnclassified: Story = {
	args: {
		filter: { label: "Unclassified", onClear: () => undefined },
		scopeLabel: "Inbox",
	},
	render: (args) => (
		<FilteredShell category="uncategorized">
			<MessageListEmpty {...args} />
		</FilteredShell>
	),
};

/** Long filter and folder names — the copy wraps rather than overflowing. */
export const FilteredEmptyLongLabels: Story = {
	...FilteredEmpty,
	args: {
		filter: { label: "Transactional", onClear: () => undefined },
		scopeLabel: "Archive/2024/Suppliers/Netherlands Enterprise Agency",
	},
};

/**
 * The review this issue is for: an unfiltered empty mailbox next to a filtered
 * empty one. If these two ever look the same, the fix is invisible.
 */
export const EmptyVersusFilteredEmpty: Story = {
	decorators: [],
	render: () => (
		<div className="flex h-screen gap-4">
			<div className="w-96 overflow-hidden border border-line">
				<MessageListEmpty />
			</div>
			<div className="w-96 overflow-hidden border border-line">
				<FilteredShell>
					<MessageListEmpty
						filter={{ label: "Personal", onClear: () => undefined }}
						scopeLabel="Inbox"
					/>
				</FilteredShell>
			</div>
		</div>
	),
};

/**
 * S4 — the filter changed and pagination restarted. The skeleton, never the
 * previous predicate's rows and never an empty state.
 */
export const FilterChangedRestarting: Story = {
	render: () => (
		<FilteredShell>
			<MessageListLoading />
		</FilteredShell>
	),
};

/** S5 — the filter is active and rows came back. */
export const FilteredWithResults: Story = {
	render: () => (
		<FilteredShell>
			<Rows count={6} />
		</FilteredShell>
	),
};

/**
 * S6 — rows already rendered, another page in flight. Words, not a bare
 * spinner: "not fetched yet" must not read as "nothing there".
 */
export const FilteredFetchingMore: Story = {
	render: () => (
		<FilteredShell>
			<Rows count={12} />
			<MessageListLoadingMore />
		</FilteredShell>
	),
};

/** The affordance on its own. */
export const LoadingMore: Story = {
	decorators: [],
	render: () => (
		<div className="w-96 border border-line">
			<MessageListLoadingMore />
		</div>
	),
};

/** A filter that matches most of a large mailbox — scrolling, no truncation. */
export const FilteredManyResults: Story = {
	render: () => (
		<FilteredShell>
			<Rows count={60} />
		</FilteredShell>
	),
};

/** Long subjects, senders and snippets under an active filter. */
export const FilteredLongContent: Story = {
	render: () => (
		<FilteredShell>
			<Rows
				rows={[longRow, ...Array.from({ length: 4 }, (_, i) => makeRow(i + 2))]}
			/>
		</FilteredShell>
	),
};

/** S7 — fail-hard error: the detail, a way back, and somewhere for it to go. */
export const ErrorState: Story = {
	render: () => (
		<FilteredShell>
			<MessageListError
				message="Request timed out while loading this mailbox."
				onRetry={() => undefined}
				onReport={() => undefined}
			/>
		</FilteredShell>
	),
};

/** A long underlying failure message still wraps inside the frame. */
export const ErrorStateLongMessage: Story = {
	render: () => (
		<FilteredShell>
			<MessageListError
				message="The IMAP server closed the connection while fetching message headers for this mailbox, after 30 seconds without a response to the SELECT command."
				onRetry={() => undefined}
				onReport={() => undefined}
			/>
		</FilteredShell>
	),
};
