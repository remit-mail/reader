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
import {
	AlertTriangle,
	Download,
	Inbox,
	Palette,
	Plus,
	Search,
	Users,
	Wrench,
	X,
} from "lucide-react";
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

/* ------------------------------------------------------------------ */
/* Danger zone: full Remit-account offboarding. GitHub-style red       */
/* section at the bottom of Accounts, with a type-to-confirm dialog.   */
/* ------------------------------------------------------------------ */

const REMIT_ACCOUNT_EMAIL = "alice.tan@gmail.example";

function DangerZone({ onDelete }: { onDelete: () => void }) {
	return (
		<div className="mt-8 rounded-sm border border-danger/50">
			<div className="flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-row-inset py-2">
				<AlertTriangle className="size-4 text-danger" />
				<h2 className="text-sm font-semibold text-danger">Danger zone</h2>
			</div>
			<div className="flex items-center justify-between gap-4 px-row-inset py-3">
				<div className="min-w-0">
					<div className="text-sm font-medium text-fg">
						Delete your Remit account
					</div>
					<p className="text-xs text-fg-subtle">
						Disconnects every account and erases Remit's copy of your mail,
						insights and preferences. Your mail at the providers is untouched.
					</p>
				</div>
				<Button
					variant="danger"
					size="sm"
					className="shrink-0"
					onClick={onDelete}
				>
					Delete your Remit account
				</Button>
			</div>
		</div>
	);
}

function DeleteRemitDialog({ onClose }: { onClose: () => void }) {
	const [confirmEmail, setConfirmEmail] = useState("");
	const [mismatch, setMismatch] = useState(false);

	const handleDelete = () => {
		if (confirmEmail.trim().toLowerCase() !== REMIT_ACCOUNT_EMAIL) {
			setMismatch(true);
			return;
		}
		setMismatch(false);
		// prototype: a real flow would call the offboarding endpoint here.
		onClose();
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
			<div className="w-full max-w-lg overflow-hidden rounded-md border border-line bg-surface shadow-xl">
				<header className="flex items-center gap-2 border-b border-line px-5 py-3">
					<AlertTriangle className="size-4 text-danger" />
					<h2 className="flex-1 text-sm font-semibold text-fg">
						Delete your Remit account
					</h2>
					<Button
						variant="ghost"
						size="sm"
						icon={<X className="size-3.5" />}
						onClick={onClose}
						aria-label="Cancel"
					/>
				</header>

				<div className="space-y-4 px-5 py-4 text-sm text-fg-muted">
					<p>This permanently erases everything Remit holds for you:</p>
					<ul className="space-y-1.5 text-xs">
						<li className="flex gap-2">
							<span className="text-danger">•</span>
							All connected accounts disconnected and their access tokens
							revoked.
						</li>
						<li className="flex gap-2">
							<span className="text-danger">•</span>
							Synced mail cache and search index.
						</li>
						<li className="flex gap-2">
							<span className="text-danger">•</span>
							AI history and insights.
						</li>
						<li className="flex gap-2">
							<span className="text-danger">•</span>
							Preferences and rules.
						</li>
					</ul>

					<div className="rounded-sm border border-line bg-surface-sunken px-3 py-2 text-xs">
						<strong className="text-fg">
							Your mail at Gmail / IMAP is not deleted.
						</strong>{" "}
						This only removes Remit's copy and its access — the mail stays in
						your provider mailboxes.
					</div>

					<a
						href="#export"
						className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
					>
						<Download className="size-3.5" />
						Export my data first
					</a>

					<div>
						<label
							htmlFor="confirm-remit-email"
							className="mb-1 block text-xs font-medium text-fg"
						>
							Type{" "}
							<span className="font-mono text-fg-muted">
								{REMIT_ACCOUNT_EMAIL}
							</span>{" "}
							to confirm
						</label>
						<Input
							id="confirm-remit-email"
							placeholder={REMIT_ACCOUNT_EMAIL}
							value={confirmEmail}
							onChange={(e) => {
								setConfirmEmail(e.target.value);
								if (mismatch) setMismatch(false);
							}}
						/>
						{mismatch && (
							<p className="mt-1.5 text-xs text-danger">
								That doesn't match {REMIT_ACCOUNT_EMAIL}. Type your Remit
								account email exactly to confirm.
							</p>
						)}
					</div>
				</div>

				<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
					<Button variant="secondary" size="sm" onClick={onClose}>
						Cancel
					</Button>
					{/* UX tenet: stays pressable; mismatch is explained on click, not
					    hidden behind a disabled button. */}
					<Button variant="danger" size="sm" onClick={handleDelete}>
						Delete everything
					</Button>
				</footer>
			</div>
		</div>
	);
}

function DangerZonePage({ dialogOpen = false }: { dialogOpen?: boolean }) {
	const [helpOpen, setHelpOpen] = useState(true);
	const [open, setOpen] = useState(dialogOpen);
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
					syncLabel="synced 1h ago"
					state="healthy"
					trailing={
						<Button variant="ghost" size="sm">
							Manage
						</Button>
					}
				/>
			</div>

			<DangerZone onDelete={() => setOpen(true)} />
			{open && <DeleteRemitDialog onClose={() => setOpen(false)} />}
		</SettingsShell>
	);
}

/**
 * Danger zone at the bottom of Accounts: a GitHub-style red section for
 * leaving Remit entirely (distinct from deleting one connected account).
 */
export const DangerZone_: Story = {
	name: "Danger zone",
	render: () => <DangerZonePage />,
};

/**
 * The type-your-email confirmation dialog open: spells out what's erased,
 * states the provider mail is untouched, offers an export off-ramp. The
 * "Delete everything" button stays pressable and explains a mismatch on
 * click rather than disabling itself.
 */
export const DangerZoneConfirm: Story = {
	name: "Danger zone — confirm dialog",
	render: () => <DangerZonePage dialogOpen />,
};
