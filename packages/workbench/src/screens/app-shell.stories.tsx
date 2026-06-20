import { AppShell, type AppShellProps } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	briefChips,
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
			chips={briefChips()}
			mutedNote="+1 muted"
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
 * Tablet tier (768–1023): list + reading two-pane, no intelligence rail (pane
 * 4 is desktop-only). The live route additionally drawer-backs the nav rail at
 * this width; here the geometry under test is the surviving two reading panes
 * (#784).
 */
export const TabletTwoPane: Story = {
	parameters: {
		viewport: { defaultViewport: "tablet" },
	},
	render: () => <StatefulShell startOpen={false} />,
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
			chips={undefined}
			mutedNote={undefined}
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
