import {
	defaultKeyboardHints,
	KeyboardHintBar,
	type ThreadSection,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	briefSections,
	briefSectionsLong,
	briefUnseen,
	categoryDrivenBriefSections,
	workId,
} from "../fixtures/workspace.js";
import { PHONE_WIDTH, phoneFrame, phoneParams } from "../lib/story-frame.js";
import { MailShell } from "../screens/mail-shell.js";

const meta: Meta = {
	title: "Flows/DailyBrief",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const brief = {
	selectedNavId: "brief",
	listTitle: "Daily brief",
	unreadCount: briefUnseen,
};

/**
 * The unified brief across accounts, one section per category: Flagged first,
 * then Personal, Transactional, Newsletter, Marketing, Social, Automated.
 * Account chips segment; the muted hobby account is excluded but keeps syncing
 * ("+1 muted").
 */
export const Default: Story = {
	render: () => (
		<MailShell {...brief} sections={briefSections()} briefFilters />
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
		<MailShell {...brief} sections={briefSectionsLong()} briefFilters />
	),
};

/** Account chip applied: every section filtered to the work account. */
export const WorkOnly: Story = {
	render: () => (
		<MailShell {...brief} sections={briefSections(workId)} briefFilters />
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
		<MailShell
			{...brief}
			unreadCount={3}
			sections={categoryDrivenBriefSections()}
			briefFilters
		/>
	),
};

/**
 * Nothing needs attention — the brief says so and stays out of the way.
 * Renders identically whether the inbox is genuinely empty or every
 * candidate sender is muted (issue #301): `sections` is empty either way,
 * and the brief carries no separate "all muted" state.
 */
export const CaughtUp: Story = {
	render: () => (
		<MailShell {...brief} unreadCount={0} sections={[]} briefFilters />
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
		<MailShell {...brief} sections={briefSections()} briefFilters />
	),
};

/**
 * Phone width (390 px): the keyboard-hint bar must NOT appear — key hints
 * are noise on a touch device. The message list fills the full height with
 * no footer strip at the bottom.
 */
export const KeyboardHintsPhone: Story = {
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<MailShell
			{...brief}
			width={PHONE_WIDTH}
			sections={briefSections()}
			briefFilters
		/>
	),
};

/**
 * (a) "All" scope: every category section rendered with its header, and the
 * caret in the list header beside the unread count. The panel it opens pushes
 * the rows down rather than covering them.
 */
export const WithFilter: Story = {
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<MailShell
			{...brief}
			width={PHONE_WIDTH}
			sections={briefSections()}
			briefFilters
		/>
	),
};

/**
 * (b) Single-category scope: narrowed to Newsletter, the brief renders FLAT
 * with NO section header.
 */
export const FilteredToCategory: Story = {
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<MailShell
			{...brief}
			width={PHONE_WIDTH}
			sections={briefSections()}
			briefFilters
			briefCategory="newsletter"
		/>
	),
};

/**
 * A shift-range that crosses a section boundary: the last row of the first
 * section through the first two of the next, in the order the rows are on
 * screen. Section membership is not part of the range — the visible row order
 * is.
 */
function crossSectionRange(sections: ThreadSection[]): string[] {
	const [first, second] = sections;
	const tail = first?.threads.at(-1)?.id;
	const head = second?.threads.slice(0, 2).map((t) => t.id) ?? [];
	return tail ? [tail, ...head] : head;
}

const multiSelectSections = briefSections();
const multiSelectIds = crossSectionRange(multiSelectSections);

/**
 * Desktop multi-select on the brief. The bar takes the header's place for as
 * long as rows are selected — the same slot, verbs and copy the mailbox list
 * raises, because it is the same bar. (The account-scoped Move trigger needs
 * live folder data, so this story leaves its slot empty.)
 *
 * The checked rows span two category sections: a range follows the rows in the
 * order they are on screen, so it crosses a section header rather than stopping
 * at it.
 */
export const MultiSelect: Story = {
	render: () => (
		<MailShell
			{...brief}
			sections={multiSelectSections}
			briefFilters
			selectedIds={multiSelectIds}
		/>
	),
};

/**
 * Touch multi-select on the brief: the same bar, at phone width. Row one is
 * the count and the verbs with a back arrow out of selection; select-all takes
 * a second row of its own below 768px.
 */
export const MultiSelectPhone: Story = {
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<MailShell
			{...brief}
			width={PHONE_WIDTH}
			sections={multiSelectSections}
			briefFilters
			selectedIds={multiSelectIds}
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
