import { AppShell, type AppShellProps } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	allThreads,
	briefSections,
	briefUnseen,
	navAccounts,
	navAccountsManyFolders,
	newsletterIntelligence,
	newsletterThread,
	phishIntelligence,
	phishThread,
	q3Intelligence,
	q3Thread,
} from "../fixtures/workspace.js";

/** A normal mailbox is one flat, unlabeled list of rows (no brief sections). */
const flatInboxSection = [{ id: "inbox", threads: allThreads }];

/** Inbox-shaped overrides shared by the flat-list stories: the Inbox nav item
 *  is active, the list is flat (no section labels), and the title reads "Inbox"
 *  with a plain unread count. */
const inboxBase: Partial<AppShellProps> = {
	selectedNavId: "mbx_personal_inbox",
	listTitle: "Inbox",
	flatList: true,
};

const meta: Meta<typeof AppShell> = {
	title: "Screens/AppShell",
	component: AppShell,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppShell>;

/** Stateful wrapper: the intelligence pane toggles for real. */
function StatefulShell({
	startOpen = true,
	...overrides
}: Partial<AppShellProps> & { startOpen?: boolean }) {
	const [open, setOpen] = useState(startOpen);
	return (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			sections={briefSections()}
			selectedThreadId="thr_q3"
			thread={q3Thread}
			intelligence={q3Intelligence}
			intelligenceOpen={open}
			onToggleIntelligence={() => setOpen((v) => !v)}
			{...overrides}
		/>
	);
}

/**
 * The 4-pane layout: nav sidebar (unified brief on top, accounts with
 * mailboxes below, one muted account), dense sectioned message list,
 * threaded reading pane, intelligence sidebar. Benign thread — the
 * sidebar stays quiet.
 */
export const Default: Story = {
	render: () => <StatefulShell />,
};

/**
 * The Mondial Relay scenario: display name claims a brand, DKIM says a
 * personal gmail mailbox sent it. Danger banner above the body, the
 * authenticity section is the loudest element on screen, similar
 * messages show the campaign.
 */
export const PhishingDetected: Story = {
	render: () => (
		<StatefulShell
			selectedThreadId="thr_phish"
			thread={phishThread}
			intelligence={phishIntelligence}
		/>
	),
};

/** Pane 4 collapsed — the classic 3-pane, toggled back via the info icon. */
export const IntelligenceCollapsed: Story = {
	render: () => <StatefulShell startOpen={false} />,
};

/**
 * No thread open: the reading pane shows the empty zero-state (Inbox icon +
 * j/k/Enter hints) and the action toolbar stays ACTIVE — its buttons are
 * pressable, not greyed out. Pressing one with nothing open surfaces a one-line
 * inline "Open a message first" rather than a disabled control (#799).
 */
export const NoThreadToolbar: Story = {
	render: () => (
		<StatefulShell
			selectedThreadId={undefined}
			thread={undefined}
			intelligence={undefined}
		/>
	),
};

/**
 * Mutt-density list: single-line rows, no avatars, status glyphs only.
 * Same data, same keys — only presentation changes. The phishing glyph
 * is the only color in the list.
 */
export const CompactDensity: Story = {
	render: () => <StatefulShell density="compact" />,
};

/**
 * Folder nav at scale: the Personal account carries the full system mailbox
 * set plus a dozen custom folders. System mailboxes (Inbox → Trash) stay
 * pinned and always visible; custom folders sit under a collapsible "Folders"
 * header that shows the first 8 with a "Show all" affordance.
 */
export const ManyFolders: Story = {
	render: () => <StatefulShell accounts={navAccountsManyFolders} />,
};

/**
 * Naughty-newsletter stress test: a garish centered-600px HTML blast
 * rendered inside the left-anchored hairline content frame. The email
 * keeps its own light colors inside the frame (never dark-inverted) —
 * check dark mode: the white blast stays contained, the chrome stays
 * calm. Intelligence shows category + the unsubscribe quick action.
 */
export const NewsletterReading: Story = {
	render: () => (
		<StatefulShell
			selectedThreadId="thr_marketing"
			thread={newsletterThread}
			intelligence={newsletterIntelligence}
		/>
	),
};

/**
 * Drafts mailbox (#844): "Drafts" is the active nav item — not "Inbox".
 * Reading pane is empty: Remit drafts open into compose, not a reading pane.
 * Design source of truth for the active-nav-item when the Drafts mailbox is open.
 */
export const DraftsActive: Story = {
	render: () => (
		<StatefulShell
			startOpen={false}
			selectedNavId="mbx_personal_drafts"
			listTitle="Drafts"
			listMeta={undefined}
			sections={[
				{
					id: "drafts",
					threads: [
						{
							id: "draft_1",
							accountId: "acc_personal",
							fromName: "Ada Lovelace",
							fromEmail: "ada@example.com",
							subject: "Re: Q3 planning",
							snippet: "Thanks — that works for me…",
							timeLabel: "Today",
						},
						{
							id: "draft_2",
							accountId: "acc_personal",
							fromName: "Team",
							fromEmail: "team@example.com",
							subject: "",
							snippet: "(no subject yet)",
							timeLabel: "Yesterday",
						},
					],
				},
			]}
			selectedThreadId={undefined}
			thread={undefined}
			intelligence={undefined}
		/>
	),
};

/* ------------------------------------------------------------------ */
/* Flat plain-inbox: a normal mailbox, not the sectioned daily brief. */
/* The live $mailboxId route renders a flat MessageList — these are    */
/* the refinable mocks for that surface and its three load states.     */
/* ------------------------------------------------------------------ */

/**
 * The plain inbox (#5): a normal mailbox is one flat, continuous list of rows —
 * no brief sections, no account chip bar. "Inbox" is the active nav item, the
 * datum shows the unread count. This is the surface we iterate list + flows on,
 * distinct from the sectioned Daily brief (the Default story).
 *
 * One responsive surface: drag the Storybook viewport and the shell reflows by
 * width — list-only below 1024px, list + reading at 1024–1279px, and the
 * intelligence rail joins at ≥1280px. No per-device variants.
 */
export const FlatInbox: Story = {
	render: () => (
		<StatefulShell
			{...inboxBase}
			listMeta="9 unread"
			sections={flatInboxSection}
			selectedThreadId="thr_q3"
			thread={q3Thread}
			intelligence={q3Intelligence}
		/>
	),
};

/**
 * Cold load: the flat list renders the skeleton (eight pulse rows) in place of
 * the rows, mirroring the live MessageList LoadingSkeleton. The reading pane is
 * empty until a thread opens. No thread/intelligence — nothing is loaded yet.
 */
export const FlatInboxLoading: Story = {
	render: () => (
		<StatefulShell
			{...inboxBase}
			startOpen={false}
			listMeta={undefined}
			sections={flatInboxSection}
			listState="loading"
			selectedThreadId={undefined}
			thread={undefined}
			intelligence={undefined}
		/>
	),
};

/**
 * Empty mailbox: a clean folder with nothing in it. Copy mirrors the live
 * MessageList — "No messages in this mailbox". The reading pane stays empty.
 */
export const FlatInboxEmpty: Story = {
	render: () => (
		<StatefulShell
			{...inboxBase}
			startOpen={false}
			listMeta={undefined}
			sections={[]}
			listState="empty"
			selectedThreadId={undefined}
			thread={undefined}
			intelligence={undefined}
		/>
	),
};

/**
 * Empty search: a query with no matches. Same empty surface, search variant of
 * the copy — "No messages match your search" (live MessageList parity).
 */
export const FlatInboxEmptySearch: Story = {
	render: () => (
		<StatefulShell
			{...inboxBase}
			startOpen={false}
			listMeta={undefined}
			sections={[]}
			listState="empty"
			searchQuery="quarterly report"
			selectedThreadId={undefined}
			thread={undefined}
			intelligence={undefined}
		/>
	),
};

/**
 * List load failure (ux.md: fail hard + loud). The rows are replaced by a
 * centered, blocking error that states plainly what failed, offers Retry (a way
 * back) and "Report a problem" (the failure goes somewhere) — never a toast,
 * never a list left looking healthy.
 */
export const FlatInboxError: Story = {
	render: () => (
		<StatefulShell
			{...inboxBase}
			startOpen={false}
			listMeta={undefined}
			sections={[]}
			listState="error"
			onRetry={() => {}}
			onReportError={() => {}}
			selectedThreadId={undefined}
			thread={undefined}
			intelligence={undefined}
		/>
	),
};
