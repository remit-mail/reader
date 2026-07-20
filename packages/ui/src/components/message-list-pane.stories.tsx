import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { inboxFilterConfig } from "../filter-presets.js";
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
 * External `selectionBar` slot mechanism, exercised at desktop width with
 * `SelectionTopBar` as a convenient stand-in node — any slot content works
 * here, the point is that the pane header is replaced. This is NOT a
 * production composition: the live desktop toolbar is `SelectionToolbar`
 * (web-client only, not in this kit); `MessageList.tsx` only ever puts
 * `SelectionTopBar` in this slot when `!isDesktop` — see `NarrowExternalSelectionBar`
 * below for that production-accurate case.
 */
export const ExternalSelectionBar: Story = {
	args: {
		isDesktop: true,
		flatList: true,
		selectionBar: (
			<SelectionTopBar
				count={2}
				onCancel={() => undefined}
				onMarkRead={() => undefined}
				onDelete={() => undefined}
			/>
		),
	},
	decorators: [desktopFrame],
};

/**
 * The production composition (`MessageList.tsx:798` gates on `!isDesktop`):
 * `SelectionTopBar` in the `selectionBar` slot at narrow width. Desktop never
 * renders this component in the slot — only `NarrowTouchList`'s width does.
 */
export const NarrowExternalSelectionBar: Story = {
	args: {
		isDesktop: false,
		flatList: true,
		selectionBar: (
			<SelectionTopBar
				count={2}
				onCancel={() => undefined}
				onMarkRead={() => undefined}
				onDelete={() => undefined}
			/>
		),
	},
	decorators: [narrowFrame],
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
