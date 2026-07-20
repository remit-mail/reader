import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
	briefFilterConfig,
	type FilterAccount,
	type FilterPreset,
	inboxFilterConfig,
} from "../filter-presets.js";
import { FilterSheet } from "./filter-sheet.js";
import { MailHeader } from "./mail-header.js";

const accounts: FilterAccount[] = [
	{ id: "all", label: "All", active: true },
	{ id: "personal", label: "Personal", count: 9 },
	{ id: "work", label: "Work", count: 14 },
];

const phoneFrame: Decorator = (Story) => (
	<div
		className="overflow-hidden border border-line bg-canvas"
		style={{ width: 390, height: 720 }}
	>
		<Story />
	</div>
);

function MockList() {
	const rows = [
		["Priya Natarajan", "Q3 roadmap review — agenda + pre-read"],
		["Mei Tan", "Sunday lunch?"],
		["Linear", "Your receipt from Linear"],
		["The Pragmatic Engineer", "Platform teams that scale"],
		["Coolblue", "Tot 30% korting op monitoren"],
		["GitHub", "[remit] PR #418: fix thread reconstruction"],
		["Strava", "Jord gave you kudos on your morning ride"],
		["Airbnb", "Your reservation in Lisbon is confirmed"],
	];
	return (
		<ul className="divide-y divide-line">
			{rows.map(([from, subject]) => (
				<li key={subject} className="px-row-inset py-3">
					<div className="text-sm font-medium text-fg">{from}</div>
					<div className="truncate text-xs text-fg-muted">{subject}</div>
				</li>
			))}
		</ul>
	);
}

/**
 * The shared mail view: the MailHeader top row, then the FilterSheet bar (its
 * caret opens the fuller filter over the list). The preset decides which groups
 * the filter offers — brief vs inbox.
 */
function MailScreen({
	title,
	unreadCount,
	preset,
	initialExpanded = false,
	initialSearchOpen = false,
	initialSearchValue = "",
	showSearch = true,
}: {
	title: string;
	unreadCount: number;
	preset: FilterPreset;
	initialExpanded?: boolean;
	initialSearchOpen?: boolean;
	initialSearchValue?: string;
	showSearch?: boolean;
}) {
	const [searchValue, setSearchValue] = useState(initialSearchValue);
	const [searchOpen, setSearchOpen] = useState(initialSearchOpen);
	const [expanded, setExpanded] = useState(initialExpanded);
	const [category, setCategory] = useState("all");
	const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
	const [source, setSource] = useState("all");

	const sources = preset.sources?.map((s) => ({
		...s,
		active: s.id === source,
	}));

	return (
		<div className="flex h-full flex-col">
			<MailHeader
				title={title}
				unreadCount={unreadCount}
				isDesktop={false}
				showSearch={showSearch}
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
					sources={sources}
					selectedCategory={category}
					activeFilters={activeFilters}
					expanded={expanded}
					onExpandedChange={setExpanded}
					onSelectCategory={setCategory}
					onSelectSource={setSource}
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
					<MockList />
				</FilterSheet>
			</div>
		</div>
	);
}

const meta: Meta<typeof MailHeader> = {
	title: "Screens/Kit/MailHeader",
	component: MailHeader,
	parameters: { layout: "centered" },
	decorators: [phoneFrame],
};
export default meta;

type Story = StoryObj<typeof MailHeader>;

/** Brief, filter collapsed: header + the FilterSheet bar with its caret. */
export const BriefFilterCollapsed: Story = {
	render: () => (
		<MailScreen
			title="Daily brief"
			unreadCount={15338}
			preset={briefFilterConfig(accounts)}
		/>
	),
};

/**
 * Brief, filter expanded — categories + Unread/Has attachment/From contacts/Today,
 * plus the accounts group because more than one account feeds the aggregate brief.
 */
export const BriefFilterExpanded: Story = {
	render: () => (
		<MailScreen
			title="Daily brief"
			unreadCount={15338}
			preset={briefFilterConfig(accounts)}
			initialExpanded
		/>
	),
};

/**
 * Single account: the brief filter drops the accounts group entirely (one
 * account is meaningless to segment) — categories + the brief chip set only.
 */
export const BriefFilterSingleAccount: Story = {
	render: () => (
		<MailScreen
			title="Daily brief"
			unreadCount={42}
			preset={briefFilterConfig(accounts.slice(0, 1))}
			initialExpanded
		/>
	),
};

/**
 * Inbox, filter expanded — categories + Unread/Flagged/Has attachment. No
 * accounts group: an inbox is already scoped to one account.
 */
export const InboxFilterExpanded: Story = {
	render: () => (
		<MailScreen
			title="Inbox"
			unreadCount={42}
			preset={inboxFilterConfig()}
			initialExpanded
		/>
	),
};

/**
 * `showSearch={false}` — the header on desktop, where the app's top bar owns
 * the search field for the whole shell. Title and unread count only: no
 * magnifier, nothing to expand. Two search inputs on one page would compete
 * for focus and for the "/" shortcut, so the header yields.
 *
 * This is what a desktop mail pane renders. Every story below it is the
 * below-desktop case, where there is no top bar and the header keeps its own
 * compact field.
 */
export const SearchOwnedByTopBar: Story = {
	render: () => (
		<MailScreen
			title="Daily brief"
			unreadCount={15338}
			preset={briefFilterConfig(accounts)}
			showSearch={false}
		/>
	),
};

/**
 * The same header for a mailbox rather than the brief — still no search
 * affordance, because whether the header owns one is a property of the layout,
 * not of which list is under it.
 */
export const SearchOwnedByTopBarInbox: Story = {
	render: () => (
		<MailScreen
			title="Inbox"
			unreadCount={42}
			preset={inboxFilterConfig()}
			showSearch={false}
		/>
	),
};

/** Mobile search collapsed to a magnifier in the header top row. */
export const MobileSearchCollapsed: Story = {
	render: () => (
		<MailScreen
			title="Daily brief"
			unreadCount={15338}
			preset={briefFilterConfig(accounts)}
		/>
	),
};

/**
 * Mobile search expanded over the title. A single X owns the dismiss: it clears
 * the query AND closes the search (the SearchBar's own inline clear is suppressed
 * here, so there is exactly one X).
 */
export const MobileSearchExpanded: Story = {
	render: () => (
		<MailScreen
			title="Daily brief"
			unreadCount={15338}
			preset={briefFilterConfig(accounts)}
			initialSearchOpen
			initialSearchValue="invoice"
		/>
	),
};

/**
 * An active query expands the bar on its own — even when search was never
 * explicitly opened (e.g. returning from a result via Back). The query is
 * visible, not hidden behind the collapsed magnifier.
 */
export const MobileSearchActiveQueryNotOpened: Story = {
	render: () => (
		<MailScreen
			title="Daily brief"
			unreadCount={15338}
			preset={briefFilterConfig(accounts)}
			initialSearchValue="invoice"
		/>
	),
};
