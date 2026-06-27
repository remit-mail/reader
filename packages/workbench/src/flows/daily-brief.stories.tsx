import {
	AppShell,
	briefFilterConfig,
	defaultKeyboardHints,
	FilterSheet,
	KeyboardHintBar,
	MailHeader,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	briefChips,
	briefSections,
	briefSectionsLong,
	briefUnseen,
	categoryDrivenBriefSections,
	navAccounts,
	workId,
} from "../fixtures/workspace.js";

const meta: Meta<typeof AppShell> = {
	title: "Flows/DailyBrief",
	component: AppShell,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppShell>;

/**
 * The unified brief across accounts, one section per category: Flagged first,
 * then Personal, Transactional, Newsletter, Marketing, Social, Automated.
 * Account chips segment; the muted hobby account is excluded but keeps syncing
 * ("+1 muted").
 */
export const Default: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			chips={briefChips()}
			mutedNote="+1 muted"
			sections={briefSections()}
		/>
	),
};

/**
 * Brief with the per-section 10 + "Show N more" expander and a composable filter
 * chip bar (Unread · Has attachment · From contacts · Today). The padded
 * Personal and Newsletter sections show their first 10 rows with an expander;
 * chips stack additively to narrow the visible threads.
 */
export const Filtered: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			chips={briefChips()}
			mutedNote="+1 muted"
			sections={briefSectionsLong()}
			briefFilters
		/>
	),
};

/** Account chip applied: every section filtered to the work account. */
export const WorkOnly: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta="Work only"
			chips={briefChips(workId)}
			mutedNote="+1 muted"
			sections={briefSections(workId)}
		/>
	),
};

/**
 * Category sections in display order.
 *
 *  - Flagged: one starred item, pinned top
 *  - Personal: a READ personal email — read state is not a routing signal
 *  - Transactional: a READ receipt
 *  - Newsletter: a newsletter from a wellknown sender — trust no longer routes
 *  - Automated: a status notification
 */
export const CategoryDriven: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={3}
			listTitle="Daily brief"
			listMeta="3 unread"
			chips={briefChips()}
			mutedNote="+1 muted"
			sections={categoryDrivenBriefSections()}
		/>
	),
};

/** Nothing needs attention — the brief says so and stays out of the way. */
export const CaughtUp: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={0}
			listTitle="Daily brief"
			listMeta="You're caught up"
			chips={briefChips()}
			mutedNote="+1 muted"
			sections={[]}
		/>
	),
};

/**
 * Keyboard-hint bar — the discoverability footer at the bottom of the
 * message list. Desktop only in the live app (hidden on touch where
 * key hints are noise). Default hints: j/k navigate · e archive ·
 * m mute · ? all shortcuts.
 *
 * Design source of truth for this state. The bar is always the last
 * element in the list pane and uses `text-2xs text-fg-subtle` tokens
 * with `Kbd` chips separated by a top border.
 */
export const KeyboardHints: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			chips={briefChips()}
			mutedNote="+1 muted"
			sections={briefSections()}
		/>
	),
};

/**
 * Phone width (390 px): the keyboard-hint bar must NOT appear — key hints
 * are noise on a touch device. The message list fills the full height with
 * no footer strip at the bottom.
 */
export const KeyboardHintsPhone: Story = {
	parameters: {
		viewport: { defaultViewport: "mobile1" },
	},
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			chips={briefChips()}
			mutedNote="+1 muted"
			sections={briefSections()}
		/>
	),
};

/**
 * The aggregate brief behind its filter: the MailHeader top row, then the
 * FilterSheet bar whose caret opens the brief preset — categories +
 * Unread/Flagged, plus the accounts group (three accounts feed the brief).
 * Fast account switching is the nav sidebar, so there is no header chip row.
 */
function BriefScreen({
	initialExpanded = false,
}: {
	initialExpanded?: boolean;
}) {
	const preset = briefFilterConfig(briefChips());
	const [searchValue, setSearchValue] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [expanded, setExpanded] = useState(initialExpanded);
	const [category, setCategory] = useState("all");
	const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
	const [source, setSource] = useState("all");
	const sources = preset.sources?.map((s) => ({
		...s,
		active: s.id === source,
	}));

	return (
		<div
			className="flex h-[760px] flex-col overflow-hidden border border-line bg-canvas"
			style={{ width: 390 }}
		>
			<MailHeader
				title="Daily brief"
				unreadCount={briefUnseen}
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
					<ul className="divide-y divide-line">
						{briefSections().flatMap((section) => [
							<li
								key={section.id}
								className="bg-surface-sunken px-row-inset py-1 text-2xs font-medium uppercase tracking-wide text-fg-subtle"
							>
								{section.label}
							</li>,
							...section.threads.map((thread) => (
								<li key={thread.id} className="px-row-inset py-2.5">
									<div className="text-sm font-medium text-fg">
										{thread.fromName}
									</div>
									<div className="truncate text-xs text-fg-muted">
										{thread.subject}
									</div>
								</li>
							)),
						])}
					</ul>
				</FilterSheet>
			</div>
		</div>
	);
}

/** Brief filter collapsed: header + the FilterSheet bar over the brief list. */
export const WithFilter: Story = {
	parameters: { layout: "centered" },
	render: () => <BriefScreen />,
};

/** Brief filter expanded: categories + Unread/Flagged + the accounts group. */
export const WithFilterExpanded: Story = {
	parameters: { layout: "centered" },
	render: () => <BriefScreen initialExpanded />,
};

/**
 * The `KeyboardHintBar` component in isolation — the same bar the brief
 * (and every other message-list pane) renders at the bottom on desktop.
 * Renders as a full-width footer strip; use inside a height-constrained
 * container to see the border and spacing in context.
 */
export const KeyboardHintBarStandalone: Story = {
	render: () => (
		<div className="flex h-dvh flex-col bg-surface">
			<div className="flex-1" />
			<KeyboardHintBar hints={defaultKeyboardHints} />
		</div>
	),
};
