import {
	AppShell,
	type BriefCategoryFilter,
	BriefSections,
	ComfortableRow,
	defaultKeyboardHints,
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
			sections={[]}
		/>
	),
};

/**
 * Keyboard-hint bar — the discoverability footer at the bottom of the
 * message list. Desktop only in the live app (hidden on touch where
 * key hints are noise). Default hints: j/k navigate · m mute ·
 * ? all shortcuts.
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
	globals: { viewport: { value: "mobile" } },
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			sections={briefSections()}
		/>
	),
};

/**
 * The aggregate brief behind its filter: the MailHeader top row, then the kit
 * `BriefSections` — which owns the FilterSheet bar (categories + attribute chips
 * + the accounts group) and flattens to a headerless list when narrowed to one
 * category. Fast account switching is the nav sidebar, so there is no header chip
 * row. The web client composes these exact blocks.
 */
function BriefScreen({
	initialCategory = "all",
	defaultExpanded = false,
}: {
	initialCategory?: BriefCategoryFilter;
	defaultExpanded?: boolean;
}) {
	const [searchValue, setSearchValue] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [category, setCategory] =
		useState<BriefCategoryFilter>(initialCategory);
	const [source, setSource] = useState("all");
	const sources = briefChips().map((s) => ({ ...s, active: s.id === source }));

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
				<BriefSections
					sections={briefSections()}
					Row={ComfortableRow}
					briefCategory={category}
					onSelectBriefCategory={setCategory}
					sources={sources}
					sourcesNote="+1 muted"
					onSelectSource={setSource}
					defaultExpanded={defaultExpanded}
				/>
			</div>
		</div>
	);
}

/**
 * (a) "All" scope: header + the FilterSheet bar over the brief, every category
 * section rendered with its header.
 */
export const WithFilter: Story = {
	parameters: { layout: "centered" },
	render: () => <BriefScreen />,
};

/**
 * (b) Single-category filter: narrowed to Newsletter, the brief renders FLAT
 * with NO section header.
 */
export const FilteredToCategory: Story = {
	parameters: { layout: "centered" },
	render: () => <BriefScreen initialCategory="newsletter" />,
};

/**
 * (c) Account sources (n>1): the filter opens onto the accounts group — three
 * accounts feed the brief, so the source pill row appears above the categories.
 */
export const WithAccountSources: Story = {
	parameters: { layout: "centered" },
	render: () => <BriefScreen defaultExpanded />,
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
