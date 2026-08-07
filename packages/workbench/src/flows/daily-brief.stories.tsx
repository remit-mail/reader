import {
	defaultKeyboardHints,
	KeyboardHintBar,
	type ThreadData,
	type ThreadRowData,
	type ThreadSection,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
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
 *
 * The cursor and the selection reach the rows on screen and no others: ⌘A
 * counts what is rendered rather than everything behind the two expanders, and
 * narrowing to a category takes the rows it hides out of the count with them.
 */
export const Filtered: Story = {
	render: () => (
		<MailShell {...brief} sections={briefSectionsLong()} briefFilters />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const shown = () =>
			canvasElement.querySelectorAll("[data-list-row]").length;

		await userEvent.click(canvas.getByLabelText("Expand filters"));
		const capped = Array.from(canvasElement.querySelectorAll("button")).filter(
			(button) => /^Show \d+ more/.test(button.textContent ?? ""),
		);
		await expect(capped.length).toBeGreaterThan(0);

		canvasElement.querySelector<HTMLElement>("[data-list-row]")?.focus();
		await userEvent.keyboard("{Meta>}a{/Meta}");
		await waitFor(() =>
			expect(
				canvas.getByText(`All ${shown()} loaded selected`),
			).toBeInTheDocument(),
		);

		const categories = canvasElement.querySelector<HTMLElement>(
			'[aria-label="Categories"]',
		);
		await expect(categories).not.toBeNull();
		await userEvent.click(
			within(categories as HTMLElement).getByRole("button", {
				name: "Newsletter",
			}),
		);
		await waitFor(() =>
			expect(
				canvas.getByText(`All ${shown()} loaded selected`),
			).toBeInTheDocument(),
		);
	},
};

/**
 * Account pill applied: the work pill is the active one in the panel behind the
 * caret, and every section is narrowed to that account.
 */
export const WorkOnly: Story = {
	render: () => (
		<MailShell
			{...brief}
			sections={briefSections()}
			briefFilters
			briefSource={workId}
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
 * Shift+arrow builds a range on the brief's rows, the range Shift+J builds. The
 * rows carry the triage keyboard's own keys instead of a traversal of their
 * own, so the cursor and the ticked rows stay one thing.
 */
export const ShiftArrowRange: Story = {
	render: () => (
		<MailShell {...brief} sections={briefSections()} briefFilters />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		canvasElement.querySelector<HTMLElement>("[data-list-row]")?.focus();

		await userEvent.keyboard("j");
		await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");

		await waitFor(() =>
			expect(canvas.getByText("2 messages selected")).toBeInTheDocument(),
		);
	},
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
 * A row the search found in a folder the brief never loaded. The brief's list is
 * the unified INBOX; the search behind a committed query reaches Archive, Sent,
 * Spam and every custom folder, so its rows arrive with no counterpart in the
 * loaded list — which is what makes the thread and the mailbox on the row the
 * only way to open it.
 */
const archivedHit: ThreadRowData = {
	id: "thr_npm_archived",
	accountId: workId,
	mailboxId: "mbx_work_archive",
	threadId: "thread_npm_archived",
	fromName: "npm",
	fromEmail: "support@npmjs.example",
	subject: "npm access token expires in 7 days",
	snippet: "Rotate the automation token before it lapses.",
	timeLabel: "Mar 2",
	isRead: true,
	category: "transactional",
};

const archivedHitThread: ThreadData = {
	subject: archivedHit.subject,
	messages: [
		{
			id: "msg_npm_archived",
			fromName: archivedHit.fromName,
			fromEmail: archivedHit.fromEmail,
			toLabel: "Alice Tan",
			dateLabel: "Mar 2 09:12",
			snippet: archivedHit.snippet,
			bodyHtml: "",
		},
	],
};

/**
 * Opening a search hit from the brief's own body (#635).
 *
 * A committed query hands the body back to the brief's rows, so what is on
 * screen is a mix: mail from the unified inbox, and mail the widened search
 * found elsewhere. The second kind cannot be opened by message alone — nothing
 * in the loaded list answers to it — so the row is opened on the thread and
 * mailbox it carries, and the reading pane fills instead of staying on "Select a
 * thread to read".
 */
export const SearchHitOutsideTheBrief: Story = {
	render: function SearchHitOutsideTheBriefRender() {
		const [opened, setOpened] = useState<ThreadRowData | undefined>(undefined);
		return (
			<MailShell
				{...brief}
				sections={[
					{
						id: "transactional",
						label: "Transactional",
						threads: [archivedHit],
					},
				]}
				briefFilters
				query="npm"
				searchResultsInBody
				selectedThreadId={opened?.id}
				thread={opened ? archivedHitThread : undefined}
				onSelectThread={(id) => {
					if (id !== archivedHit.id) return;
					if (!archivedHit.threadId || !archivedHit.mailboxId) return;
					setOpened(archivedHit);
				}}
			/>
		);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText("Select a thread to read"),
		).toBeInTheDocument();

		await userEvent.click(canvas.getByText(archivedHit.subject));

		await waitFor(() =>
			expect(canvas.getByText("Mar 2 09:12")).toBeInTheDocument(),
		);
		await expect(canvas.queryByText("Select a thread to read")).toBeNull();
	},
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
