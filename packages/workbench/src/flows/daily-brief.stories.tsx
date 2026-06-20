import {
	AppShell,
	defaultKeyboardHints,
	KeyboardHintBar,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
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
 * The unified brief across accounts, grouped by attention: VIP/known
 * unread first, then flagged, then everything else. Account chips
 * segment; the muted hobby account is excluded but keeps syncing
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
 * Brief with collapsible sections and a composable filter chip bar (Unread ·
 * Has attachment · From contacts · Today). The padded "Everything else" section
 * starts collapsed; chips stack additively to narrow the visible threads.
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
 * Category-driven routing: all four sections in display order.
 *
 *  - Needs attention: a READ personal email + a READ transactional invoice —
 *    read state is not a routing signal; category drives placement
 *  - Flagged: one starred item
 *  - Daily brief: a newsletter from a wellknown sender — trust doesn't
 *    override the digest bucket; category wins
 *  - Everything else: an automated notification — not personal/transactional,
 *    so it stays out of the way
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
