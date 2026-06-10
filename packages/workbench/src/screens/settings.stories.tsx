import {
	AccountHealthCard,
	Badge,
	Button,
	cn,
	Input,
	Kbd,
	SenderFlagRow,
	type SettingsNavItem,
	SettingsShell,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Inbox, Palette, Plus, Search, Users, Wrench, X } from "lucide-react";
import { useState } from "react";
import {
	type SenderGroup,
	senderGroupLabels,
	senders,
	sendersByGroup,
} from "../fixtures/senders.js";

const meta: Meta = {
	title: "Screens/Settings",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const navItems: SettingsNavItem[] = [
	{ id: "accounts", label: "Accounts", icon: <Inbox className="size-4" /> },
	{
		id: "senders",
		label: "Senders & Rules",
		icon: <Users className="size-4" />,
	},
	{
		id: "appearance",
		label: "Appearance",
		icon: <Palette className="size-4" />,
	},
	{ id: "advanced", label: "Advanced", icon: <Wrench className="size-4" /> },
];

/* ------------------------------------------------------------------ */
/* Senders & Rules: 2-pane page — rule groups left, dense filterable  */
/* sender table right. Built to scale to hundreds of rows.            */
/* ------------------------------------------------------------------ */

const groups: SenderGroup[] = ["vip", "muted", "blocked"];

const sendersHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">VIP</strong> senders get priority surface in
			the daily brief and notification escalation, even when an account is
			quiet.
		</p>
		<p>
			<strong className="text-fg">Muted</strong> senders never notify and stay
			out of the brief. Their mail still syncs and stays searchable.
		</p>
		<p>
			<strong className="text-fg">Blocked</strong> senders never load images and
			go straight to junk.
		</p>
		<p>
			Tip: flag from the keyboard on any message — <Kbd>v</Kbd> VIP,{" "}
			<Kbd>m</Kbd> mute, <Kbd>b</Kbd> block. Every rule an automation creates
			shows up here and can be removed.
		</p>
	</div>
);

function SendersPage() {
	const [group, setGroup] = useState<SenderGroup>("vip");
	const [query, setQuery] = useState("");
	const [helpOpen, setHelpOpen] = useState(true);

	const q = query.trim().toLowerCase();
	const rows = sendersByGroup(group).filter(
		(s) =>
			q.length === 0 ||
			s.name.toLowerCase().includes(q) ||
			s.email.toLowerCase().includes(q),
	);

	return (
		<SettingsShell
			items={navItems}
			activeId="senders"
			title="Senders & Rules"
			description="Per-sender preferences — set with one key from any message, managed here."
			flush
			help={sendersHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((v) => !v)}
		>
			<div className="flex min-h-0 flex-1">
				{/* rule groups */}
				<aside className="w-44 shrink-0 border-r border-line py-2 pl-3 pr-2">
					{groups.map((g) => (
						<button
							key={g}
							type="button"
							onClick={() => setGroup(g)}
							className={cn(
								"flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors",
								g === group
									? "bg-accent-2-soft font-medium text-accent-2"
									: "text-fg-muted hover:bg-surface-sunken hover:text-fg",
							)}
						>
							<span className="flex-1 truncate">{senderGroupLabels[g]}</span>
							<span
								className={cn(
									"text-2xs tabular-nums",
									g === group ? "text-accent-2" : "text-fg-subtle",
								)}
							>
								{sendersByGroup(g).length}
							</span>
						</button>
					))}
				</aside>

				{/* dense, filterable sender table */}
				<div className="flex min-w-0 flex-1 flex-col">
					<div className="border-b border-line px-row-inset py-2">
						<Input
							icon={<Search className="size-4" />}
							placeholder={`Filter ${senderGroupLabels[group].toLowerCase()} by name or address`}
							className="h-8 max-w-sm"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
					</div>
					<div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
						{rows.map((s) => (
							<SenderFlagRow
								key={s.id}
								name={s.name}
								email={s.email}
								danger={s.group === "blocked"}
								meta={
									s.replyCount > 0
										? `${s.inboundCount} received · you replied ${s.replyCount}×`
										: `${s.inboundCount} received · you've never replied`
								}
								caption={s.caption}
								trailing={
									<Button
										variant="ghost"
										size="sm"
										icon={<X className="size-3.5" />}
										aria-label="Remove flag"
									/>
								}
							/>
						))}
						{rows.length === 0 && (
							<p className="px-row-inset py-5 text-sm text-fg-subtle">
								No {senderGroupLabels[group].toLowerCase()} match “{query}”.
							</p>
						)}
					</div>
					<footer className="flex items-center justify-between border-t border-line px-row-inset py-1 text-2xs text-fg-subtle">
						<span>
							{rows.length} of {senders.length} flagged senders
						</span>
						<span>
							<Kbd>j</Kbd> <Kbd>k</Kbd> navigate · <Kbd>⌫</Kbd> remove flag
						</span>
					</footer>
				</div>
			</div>
		</SettingsShell>
	);
}

/**
 * Senders & Rules as a 2-pane page: rule groups (with counts) on the
 * left, a dense scrollable, filterable sender table on the right —
 * the layout holds at hundreds of VIPs. Contextual help in the right
 * rail, collapsible like the intelligence panel.
 */
export const SendersAndRules: Story = {
	render: () => <SendersPage />,
};

/* ------------------------------------------------------------------ */
/* Accounts                                                           */
/* ------------------------------------------------------------------ */

const accountsHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">Sync health</strong> shows the IMAP connection
			state and the last successful sync per account.
		</p>
		<p>
			<strong className="text-fg">Error</strong> means the last connection
			attempt failed — the raw server response is shown on the card. Reconnect
			re-runs the connection test from the add-account wizard.
		</p>
		<p>
			<strong className="text-fg">Muted</strong> accounts keep syncing but stay
			out of the daily brief and unified counts.
		</p>
	</div>
);

function AccountsPage() {
	const [helpOpen, setHelpOpen] = useState(true);
	return (
		<SettingsShell
			items={navItems}
			activeId="accounts"
			title="Accounts"
			description="Every account keeps syncing — muted ones just stay out of unified views."
			help={accountsHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((v) => !v)}
		>
			<div className="flex items-center justify-between">
				<Badge tone="neutral">3 accounts</Badge>
				<Button
					variant="primary"
					size="sm"
					icon={<Plus className="size-3.5" />}
				>
					Add account
				</Button>
			</div>
			<div className="space-y-3">
				<AccountHealthCard
					label="Personal"
					email="alice.tan@gmail.example"
					connector="IMAP"
					syncLabel="synced 2m ago"
					state="healthy"
					trailing={
						<Button variant="ghost" size="sm">
							Manage
						</Button>
					}
				/>
				<AccountHealthCard
					label="Work"
					email="alice@northwind.example"
					connector="IMAP"
					syncLabel="last sync 3h ago"
					state="error"
					errorDetail="AUTHENTICATIONFAILED: [ALERT] Application-specific password required"
					trailing={
						<Button variant="secondary" size="sm">
							Reconnect
						</Button>
					}
				/>
				<AccountHealthCard
					label="Synthwave Forum"
					email="alice@synthcollective.example"
					connector="IMAP"
					syncLabel="synced 12m ago"
					state="muted"
					trailing={
						<Button variant="ghost" size="sm">
							Manage
						</Button>
					}
				/>
			</div>
		</SettingsShell>
	);
}

/**
 * Accounts: left-aligned content column, one card per account with
 * connector, sync health and state. "Add account" reuses the
 * onboarding wizard, steps 2–7.
 */
export const Accounts: Story = {
	render: () => <AccountsPage />,
};
