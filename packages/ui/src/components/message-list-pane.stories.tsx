import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { inboxFilterConfig } from "../filter-presets.js";
import { rowSelectIntent, useSelection } from "../lib/use-selection.js";
import type { ThreadSection } from "./app-shell-types.js";
import { FilterSheet } from "./filter-sheet.js";
import { MailHeader } from "./mail-header.js";
import { MessageListPane } from "./message-list-pane.js";
import { SelectionTopBar } from "./selection-top-bar.js";

const sections: ThreadSection[] = [
	{
		id: "today",
		label: "Today",
		threads: [
			{
				id: "t1",
				accountId: "a1",
				fromName: "Alex Rivera",
				fromEmail: "alex@example.com",
				subject: "Q3 planning notes",
				snippet: "Here are the notes from today's planning session.",
				timeLabel: "9:42",
				category: "personal",
			},
			{
				id: "t2",
				accountId: "a1",
				fromName: "Acme Billing",
				fromEmail: "billing@acme.com",
				subject: "Your invoice is ready",
				snippet: "Invoice #1042 is available to view.",
				timeLabel: "8:15",
				isRead: true,
				category: "transactional",
			},
		],
	},
	{
		id: "earlier",
		label: "Earlier",
		threads: [
			{
				id: "t3",
				accountId: "a1",
				fromName: "Weekly Digest",
				fromEmail: "news@digest.com",
				subject: "This week in tech",
				snippet: "The top stories you might have missed.",
				timeLabel: "Mon",
				category: "newsletter",
				messageCount: 3,
			},
		],
	},
];

const meta: Meta<typeof MessageListPane> = {
	title: "Screens/Kit/MessageListPane",
	component: MessageListPane,
	parameters: { layout: "centered" },
	args: {
		listTitle: "Inbox",
		listMeta: "3 conversations",
		sections,
		onSelectThread: () => undefined,
		onSelectBriefCategory: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof MessageListPane>;

const desktopFrame: Decorator = (Story) => (
	<div className="h-screen w-96 overflow-hidden border border-line">
		<Story />
	</div>
);

const narrowFrame: Decorator = (Story) => (
	<div
		className="overflow-hidden border border-line"
		style={{ width: 390, height: 844 }}
	>
		<Story />
	</div>
);

export const DesktopList: Story = {
	args: { isDesktop: true, flatList: true },
	decorators: [desktopFrame],
};

export const NarrowTouchList: Story = {
	args: { isDesktop: false, flatList: true },
	decorators: [narrowFrame],
};

export const Brief: Story = {
	args: { isDesktop: true, briefFilters: true, sections },
	decorators: [desktopFrame],
};

/**
 * Inbox behind its filter: the MailHeader top row, then the FilterSheet bar
 * whose caret opens the inbox preset — categories + Unread/Flagged/Has
 * attachment. No accounts group: an inbox is already scoped to one account.
 */
function InboxScreen({
	initialExpanded = false,
}: {
	initialExpanded?: boolean;
}) {
	const preset = inboxFilterConfig();
	const [searchValue, setSearchValue] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [expanded, setExpanded] = useState(initialExpanded);
	const [category, setCategory] = useState("all");
	const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
	const rows = sections.flatMap((s) => s.threads);

	return (
		<div className="flex h-full flex-col">
			<MailHeader
				title="Inbox"
				unreadCount={3}
				isDesktop={false}
				onMenuClick={() => undefined}
				searchValue={searchValue}
				onSearchChange={setSearchValue}
				searchOpen={searchOpen}
				onSearchOpenChange={setSearchOpen}
			/>
			<div className="min-h-0 flex-1">
				<FilterSheet
					categories={preset.categories}
					filters={preset.filters}
					sources={preset.sources}
					selectedCategory={category}
					activeFilters={activeFilters}
					expanded={expanded}
					onExpandedChange={setExpanded}
					onSelectCategory={setCategory}
					onToggleFilter={(id) =>
						setActiveFilters((prev) => {
							const next = new Set(prev);
							if (next.has(id)) next.delete(id);
							else next.add(id);
							return next;
						})
					}
					onClear={() => {
						setCategory("all");
						setActiveFilters(new Set());
					}}
				>
					<ul className="divide-y divide-line">
						{rows.map((thread) => (
							<li key={thread.id} className="px-row-inset py-2.5">
								<div className="text-sm font-medium text-fg">
									{thread.fromName}
								</div>
								<div className="truncate text-xs text-fg-muted">
									{thread.subject}
								</div>
							</li>
						))}
					</ul>
				</FilterSheet>
			</div>
		</div>
	);
}

/** Inbox filter collapsed: header + the FilterSheet bar over the inbox list. */
export const InboxWithFilter: Story = {
	render: () => <InboxScreen />,
	decorators: [narrowFrame],
};

/** Inbox filter expanded: categories + Unread/Flagged/Has attachment. */
export const InboxWithFilterExpanded: Story = {
	render: () => <InboxScreen initialExpanded />,
	decorators: [narrowFrame],
};

/** Consumer-supplied `listBody` slot — the pane renders the chrome (header,
 *  keyboard hints) while the caller owns the scrollable rows. This models
 *  the web-client's virtualized inbox path. */
export const CustomListBody: Story = {
	args: {
		isDesktop: true,
		flatList: true,
		listBody: (
			<div className="flex-1 overflow-y-auto divide-y divide-line">
				{sections.flatMap((s) =>
					s.threads.map((t) => (
						<a
							key={t.id}
							href={`?selectedMessageId=${t.id}`}
							className="flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken"
						>
							<span className="font-medium text-sm">{t.fromName}</span>
							<span className="text-sm text-fg-muted truncate">
								{t.subject}
							</span>
						</a>
					)),
				)}
			</div>
		),
	},
	decorators: [desktopFrame],
};

/**
 * The pane under a selection its consumer owns. The pane draws the checkboxes
 * and holds none of the state, so the interaction here is the app's: click a
 * checkbox to tick one row, cmd/ctrl-click a row to tick it without opening it,
 * shift-click to range from the last row touched, and select-all covers the
 * rows on screen.
 *
 * The bar is the header for every state of the list — it names the mailbox with
 * nothing ticked and carries the count and the verbs from the first ticked row.
 */
function SelectableList({ isDesktop }: { isDesktop: boolean }) {
	const selection = useSelection();
	const orderedIds = sections.flatMap((s) => s.threads).map((t) => t.id);
	const allSelected = orderedIds.every((id) => selection.selectedIds.has(id));

	return (
		<MessageListPane
			listTitle="Inbox"
			listMeta="3 conversations"
			sections={sections}
			flatList
			isDesktop={isDesktop}
			onSelectThread={() => undefined}
			selection={{
				selectedIds: selection.selectedIds,
				onToggle: selection.toggle,
				onRowSelect: (id, modifiers) => {
					const intent = rowSelectIntent(modifiers);
					if (intent === "range") {
						selection.selectRange(orderedIds, id);
						return true;
					}
					if (intent === "toggle") {
						selection.toggle(id);
						return true;
					}
					selection.clearSelection();
					selection.setAnchor(id);
					return false;
				},
			}}
			selectionBar={
				<SelectionTopBar
					title="Inbox"
					count={selection.selectedCount}
					onCancel={selection.clearSelection}
					onMarkRead={() => undefined}
					onJunk={() => undefined}
					onOrganize={() => undefined}
					onDelete={() => undefined}
					selectAll={{
						checked: allSelected,
						indeterminate: selection.hasSelection && !allSelected,
						onChange: () => selection.toggleAll(orderedIds),
					}}
				/>
			}
		/>
	);
}

/** Desktop: from 768px up the labelled select-all sits inline in the bar. */
export const ConsumerSelection: Story = {
	render: () => <SelectableList isDesktop />,
	decorators: [desktopFrame],
};

/**
 * The same list at phone width: checkboxes stay put once a row is ticked, and
 * select-all moves to a second row so row one stays a count and the verbs.
 */
export const NarrowConsumerSelection: Story = {
	render: () => <SelectableList isDesktop={false} />,
	decorators: [narrowFrame],
};

/** An empty mailbox, unfiltered: one plain line and no completeness claim. */
export const EmptyState: Story = {
	args: {
		isDesktop: true,
		flatList: true,
		listState: "empty",
	},
	decorators: [desktopFrame],
};

/**
 * The same pane under a category filter — the composition the inbox ships
 * (#306). The pane forwards the filter and the scope to the empty state, so a
 * narrowed list states what was read instead of reading as an empty mailbox.
 */
export const FilteredEmptyState: Story = {
	args: {
		isDesktop: true,
		flatList: true,
		listState: "empty",
		listFilter: {
			label: "Personal",
			reach: "whole-folder",
			onClear: () => undefined,
		},
		listScopeLabel: "Inbox",
	},
	decorators: [desktopFrame],
};

/** Fail-loud error state — the specific failure detail is surfaced under the
 *  headline (not a bare "something went wrong"), with a way back (Retry) and a
 *  place for the failure to go (Report a problem). */
export const ErrorState: Story = {
	args: {
		isDesktop: true,
		flatList: true,
		listState: "error",
		errorMessage: "Request timed out while loading this mailbox.",
		onRetry: () => undefined,
		onReportError: () => undefined,
	},
	decorators: [desktopFrame],
};
