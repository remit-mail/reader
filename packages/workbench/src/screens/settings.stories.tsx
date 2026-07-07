import {
	AccountHealthCard,
	Badge,
	Banner,
	Button,
	DangerZoneSection,
	Dialog,
	Input,
	Kbd,
	SegmentedControl,
	SenderFlagRow,
	SenderGroupSwitch,
	type SettingsNavItem,
	SettingsShell,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	AlertTriangle,
	Download,
	Inbox,
	Loader2,
	Palette,
	Plus,
	Search,
	Users,
	Wrench,
	X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	type SenderGroup,
	senderGroupLabels,
	senders,
	sendersByGroup,
} from "../fixtures/senders.js";
import { EditAccountForm } from "./edit-account.js";

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
/* Senders & Rules: rule-group switch (rail on desktop, tab strip on   */
/* mobile) + dense filterable sender table that drops to stacked rows.  */
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
			<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
				<SenderGroupSwitch
					active={group}
					onSelect={setGroup}
					options={groups.map((g) => ({
						id: g,
						label: senderGroupLabels[g],
						count: sendersByGroup(g).length,
					}))}
				/>

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
 * Senders & Rules: the group switch is a rail on desktop and a tab strip
 * below it, so the dense table owns the full width on phone and tablet.
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

function AccountsShell({
	children,
	count,
}: {
	children: ReactNode;
	count: number | null;
}) {
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
				<Badge tone="neutral">
					{count == null ? "accounts" : `${count} accounts`}
				</Badge>
				<Button
					variant="primary"
					size="sm"
					icon={<Plus className="size-3.5" />}
				>
					Add account
				</Button>
			</div>
			{children}
		</SettingsShell>
	);
}

function ManageButton() {
	return (
		<Button variant="ghost" size="sm">
			Manage
		</Button>
	);
}

const accountCards = (
	<div className="space-y-3">
		<AccountHealthCard
			label="Personal"
			email="alice.tan@gmail.example"
			connector="IMAP"
			syncLabel="synced 2m ago"
			state="healthy"
			trailing={<ManageButton />}
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
			trailing={<ManageButton />}
		/>
	</div>
);

/**
 * Accounts: one card per account with connector, sync health and state.
 * Every card carries Manage; the errored card swaps in Reconnect.
 */
export const Accounts: Story = {
	render: () => <AccountsShell count={3}>{accountCards}</AccountsShell>,
};

/**
 * An account whose last-sync date is missing or unparseable. The app derives an
 * empty relative-time string for such a date and falls back to "never synced" —
 * the row must render, never crash the whole Accounts screen over one bad date.
 */
export const AccountsMissingSyncDate: Story = {
	render: () => (
		<AccountsShell count={1}>
			<div className="space-y-3">
				<AccountHealthCard
					label="Personal"
					email="alice.tan@gmail.example"
					connector="IMAP"
					syncLabel="never synced"
					state="healthy"
					trailing={<ManageButton />}
				/>
			</div>
		</AccountsShell>
	),
};

/* ------------------------------------------------------------------ */
/* Shell breakpoints: phone (390) and tablet (768).                   */
/*                                                                    */
/* Below desktop (lg = 1024px) the three-column layout collapses:    */
/*   - Nav rail → hamburger drawer (closed by default)               */
/*   - Active pane → full width                                       */
/*   - Tips rail → CircleHelp disclosure in the header               */
/*                                                                    */
/* These stories document the live behaviour — the same Accounts page */
/* rendered at the two sub-desktop breakpoints. Each breakpoint has a */
/* "with tips" and a "no tips" variant to document the conditional    */
/* toggle: the CircleHelp icon must only appear when help is passed.  */
/* ------------------------------------------------------------------ */

function AccountsShellNoHelp({ children }: { children: ReactNode }) {
	return (
		<SettingsShell
			items={navItems}
			activeId="accounts"
			title="Accounts"
			description="Every account keeps syncing — muted ones just stay out of unified views."
		>
			{children}
		</SettingsShell>
	);
}

/**
 * Phone (390px): hamburger opens the nav drawer; the active pane owns
 * the full width. The tips rail is replaced by a CircleHelp icon in
 * the header that expands an inline disclosure on tap.
 */
export const ShellPhone: Story = {
	name: "Shell — phone",
	parameters: { viewport: { defaultViewport: "mobile1" } },
	render: () => <AccountsShell count={3}>{accountCards}</AccountsShell>,
};

/**
 * Phone (390px), no tips: no help prop — the CircleHelp toggle must
 * not appear in the header. Tapping the header area should never open
 * an empty disclosure.
 */
export const ShellPhoneNoTips: Story = {
	name: "Shell — phone, no tips",
	parameters: { viewport: { defaultViewport: "mobile1" } },
	render: () => (
		<AccountsShellNoHelp>
			<Badge tone="neutral">3 accounts</Badge>
			{accountCards}
		</AccountsShellNoHelp>
	),
};

/**
 * Tablet (768px): same collapse mode as phone — hamburger header, no
 * nav rail, no persistent tips rail. The content column is wider.
 */
export const ShellTablet: Story = {
	name: "Shell — tablet",
	parameters: { viewport: { defaultViewport: "ipad" } },
	render: () => <AccountsShell count={3}>{accountCards}</AccountsShell>,
};

/**
 * Tablet (768px), no tips: no help prop — the CircleHelp toggle must
 * not appear in the header.
 */
export const ShellTabletNoTips: Story = {
	name: "Shell — tablet, no tips",
	parameters: { viewport: { defaultViewport: "ipad" } },
	render: () => (
		<AccountsShellNoHelp>
			<Badge tone="neutral">3 accounts</Badge>
			{accountCards}
		</AccountsShellNoHelp>
	),
};

/** Empty state: no accounts yet, with the first-run call to action. */
export const AccountsEmpty: Story = {
	name: "Accounts — empty",
	render: () => (
		<AccountsShell count={0}>
			<div className="py-12 text-sm text-fg-muted">
				<p className="mb-3">No accounts configured.</p>
				<Button
					variant="primary"
					size="sm"
					icon={<Plus className="size-3.5" />}
				>
					Add your first account
				</Button>
			</div>
		</AccountsShell>
	),
};

/** Loading skeleton while the account config request is in flight. */
export const AccountsLoading: Story = {
	name: "Accounts — loading",
	render: () => (
		<AccountsShell count={null}>
			{/* biome-ignore lint/a11y/useSemanticElements: <div> with role="status" preserves block layout; <output> is inline */}
			<div
				className="space-y-3"
				role="status"
				aria-busy="true"
				aria-label="Loading accounts"
			>
				{[0, 1].map((i) => (
					<div
						key={i}
						className="animate-pulse rounded-sm border border-line bg-surface p-4"
					>
						<div className="flex items-center gap-3">
							<div className="size-10 rounded-full bg-surface-sunken" />
							<div className="flex-1 space-y-2">
								<div className="h-4 w-1/3 rounded bg-surface-sunken" />
								<div className="h-3 w-2/3 rounded bg-surface-sunken" />
							</div>
						</div>
					</div>
				))}
			</div>
		</AccountsShell>
	),
};

/** OAuth success banner after a Microsoft 365 reconnect returns. */
export const AccountsOauthSuccess: Story = {
	name: "Accounts — OAuth success",
	render: () => (
		<AccountsShell count={3}>
			<Banner tone="success" variant="soft" onDismiss={() => {}}>
				Account connected successfully.
			</Banner>
			{accountCards}
		</AccountsShell>
	),
};

/** OAuth error banner when the provider redirect carried a failure. */
export const AccountsOauthError: Story = {
	name: "Accounts — OAuth error",
	render: () => (
		<AccountsShell count={3}>
			<Banner tone="danger" variant="soft" onDismiss={() => {}}>
				Your organisation's admin needs to approve Remit. Ask your IT admin to
				grant the required permissions.
			</Banner>
			{accountCards}
		</AccountsShell>
	),
};

function DeleteAccountConfirm({ pending = false }: { pending?: boolean }) {
	return (
		<Dialog open onClose={() => {}} title="Delete account">
			<header className="flex items-center gap-2 border-b border-line px-5 py-3">
				<AlertTriangle className="size-4 shrink-0 text-danger" />
				<span className="flex-1 text-sm font-semibold text-fg">
					Delete account
				</span>
				<Button
					variant="ghost"
					size="sm"
					icon={<X className="size-3.5" />}
					aria-label="Cancel"
				/>
			</header>
			<div className="space-y-3 px-5 py-4 text-sm text-fg-muted">
				<p className="text-center text-lg font-medium text-fg">Are you sure?</p>
				<p className="text-center">alice@northwind.example</p>
				<ul className="list-inside list-disc space-y-1">
					<li>Remove the account from your settings</li>
					<li>Stop syncing mail for this account</li>
					<li>Delete all associated data (within 24 hours)</li>
				</ul>
			</div>
			<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
				<Button variant="secondary" size="sm">
					Cancel
				</Button>
				<Button
					variant="danger"
					size="sm"
					aria-busy={pending}
					icon={
						pending ? <Loader2 className="size-3.5 animate-spin" /> : undefined
					}
				>
					{pending ? "Deleting…" : "Delete account"}
				</Button>
			</footer>
		</Dialog>
	);
}

/**
 * Per-account delete confirm: spells out what removing one connected
 * account does. The confirm stays pressable and shows "Deleting…" via
 * `aria-busy` rather than disabling itself.
 */
export const AccountsDeleteConfirm: Story = {
	name: "Accounts — delete confirm",
	render: () => (
		<AccountsShell count={3}>
			{accountCards}
			<DeleteAccountConfirm />
		</AccountsShell>
	),
};

/* ------------------------------------------------------------------ */
/* Edit account: slide-in panel from "Manage" (RFC 021). Email address  */
/* is fixed; Display Name is the editable, optional account label.      */
/* ------------------------------------------------------------------ */

/**
 * Edit account form: the slide-in panel reached from a card's Manage
 * button. Display Name is the optional, editable label — here pre-filled
 * with the account's current name.
 */
export const AccountEdit: Story = {
	name: "Accounts — edit",
	render: () => (
		<AccountsShell count={3}>
			{accountCards}
			<EditAccountForm email="alice@northwind.example" displayName="Work" />
		</AccountsShell>
	),
};

/**
 * Edit account with no Display Name set: the field is empty and shows its
 * placeholder, documenting that blank falls back to a derived name.
 */
export const AccountEditNoDisplayName: Story = {
	name: "Accounts — edit, no display name",
	render: () => (
		<AccountsShell count={3}>
			{accountCards}
			<EditAccountForm email="alice@northwind.example" />
		</AccountsShell>
	),
};

/* ------------------------------------------------------------------ */
/* Danger zone: full Remit-account offboarding. Its own section below   */
/* a clean accounts list, with a type-to-confirm dialog.                */
/* ------------------------------------------------------------------ */

const REMIT_ACCOUNT_EMAIL = "alice.tan@gmail.example";

function DeleteRemitDialog({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [confirmEmail, setConfirmEmail] = useState("");
	const [mismatch, setMismatch] = useState(false);

	const handleDelete = () => {
		if (confirmEmail.trim().toLowerCase() !== REMIT_ACCOUNT_EMAIL) {
			setMismatch(true);
			return;
		}
		setMismatch(false);
		onClose();
	};

	return (
		<Dialog open={open} onClose={onClose} title="Delete your Remit account">
			<header className="flex items-center gap-2 border-b border-line px-5 py-3">
				<AlertTriangle className="size-4 shrink-0 text-danger" />
				<span className="flex-1 text-sm font-semibold text-fg">
					Delete your Remit account
				</span>
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
						All connected accounts disconnected and their access tokens revoked.
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
					This only removes Remit's copy and its access — the mail stays in your
					provider mailboxes.
				</div>

				<button
					type="button"
					className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
				>
					<Download className="size-3.5" />
					Export my data first
				</button>

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
						<p className="mt-1.5 text-xs text-danger" role="alert">
							That doesn't match {REMIT_ACCOUNT_EMAIL}. Type your Remit account
							email exactly to confirm.
						</p>
					)}
				</div>
			</div>

			<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
				<Button variant="secondary" size="sm" onClick={onClose}>
					Cancel
				</Button>
				<Button variant="danger" size="sm" onClick={handleDelete}>
					Delete everything
				</Button>
			</footer>
		</Dialog>
	);
}

function DangerZonePage({ dialogOpen = false }: { dialogOpen?: boolean }) {
	const [open, setOpen] = useState(dialogOpen);
	return (
		<AccountsShell count={2}>
			<div className="space-y-3">
				<AccountHealthCard
					label="Personal"
					email="alice.tan@gmail.example"
					connector="IMAP"
					syncLabel="synced 2m ago"
					state="healthy"
					trailing={<ManageButton />}
				/>
				<AccountHealthCard
					label="Work"
					email="alice@northwind.example"
					connector="IMAP"
					syncLabel="synced 1h ago"
					state="healthy"
					trailing={<ManageButton />}
				/>
			</div>

			<div className="mt-8 border-t border-line pt-6">
				<DangerZoneSection
					title="Delete your Remit account"
					description="Disconnects every account and erases Remit's copy of your mail, insights and preferences. Your mail at the providers is untouched."
					action={
						<Button variant="danger" size="sm" onClick={() => setOpen(true)}>
							Delete your Remit account
						</Button>
					}
				/>
			</div>
			<DeleteRemitDialog open={open} onClose={() => setOpen(false)} />
		</AccountsShell>
	);
}

/**
 * Danger zone as its own section below a clean accounts list: a
 * GitHub-style red block for leaving Remit entirely (distinct from
 * deleting one connected account).
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

/* ------------------------------------------------------------------ */
/* Appearance: density + theme segmented controls, stored-locally note. */
/* ------------------------------------------------------------------ */

const appearanceHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">Density</strong> controls how much information
			fits on screen. Compact is great on smaller displays; Comfortable gives
			each item more breathing room.
		</p>
		<p>
			<strong className="text-fg">Theme</strong> switches between light, dark,
			and system-preference modes instantly. The change takes effect across the
			whole app immediately.
		</p>
		<p className="text-2xs text-fg-subtle">
			Preferences are stored locally in this browser. Server-side sync is coming
			soon.
		</p>
	</div>
);

function AppearancePage() {
	const [helpOpen, setHelpOpen] = useState(true);
	const [density, setDensity] = useState("comfortable");
	const [theme, setTheme] = useState("system");
	return (
		<SettingsShell
			items={navItems}
			activeId="appearance"
			title="Appearance"
			description="Display density and colour theme — instant-apply."
			help={appearanceHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((v) => !v)}
		>
			<div className="space-y-5">
				<div className="space-y-2">
					<p className="text-sm font-medium text-fg">Density</p>
					<SegmentedControl
						name="density"
						aria-label="Density"
						value={density}
						onChange={setDensity}
						options={[
							{ value: "comfortable", label: "Comfortable" },
							{ value: "compact", label: "Compact" },
						]}
					/>
					<p className="text-xs text-fg-subtle">
						Controls the spacing of message rows in the mail list.
					</p>
				</div>

				<div className="space-y-2">
					<p className="text-sm font-medium text-fg">Theme</p>
					<SegmentedControl
						name="theme"
						aria-label="Theme"
						value={theme}
						onChange={setTheme}
						options={[
							{ value: "system", label: "System" },
							{ value: "light", label: "Light" },
							{ value: "dark", label: "Dark" },
						]}
					/>
					<p className="text-xs text-fg-subtle">
						Applies immediately. System default follows your OS preference.
					</p>
				</div>
			</div>
		</SettingsShell>
	);
}

/**
 * Appearance: density and theme as segmented controls, with the
 * stored-locally note in the tips rail.
 */
export const Appearance: Story = {
	render: () => <AppearancePage />,
};

/* ------------------------------------------------------------------ */
/* Advanced: stub + About / version.                                   */
/* ------------------------------------------------------------------ */

const advancedHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">Notification rules</strong>, data export, and
			per-account diagnostics are coming in a future release.
		</p>
	</div>
);

function AdvancedPage() {
	const [helpOpen, setHelpOpen] = useState(true);
	return (
		<SettingsShell
			items={navItems}
			activeId="advanced"
			title="Advanced"
			description="Notification rules, export, and diagnostics."
			help={advancedHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((v) => !v)}
		>
			<p className="text-sm text-fg-muted">
				Advanced options — notification rules, data export, and raw sync
				diagnostics — are coming in a future release.
			</p>
			<div className="mt-4 border-t border-line pt-4">
				<p className="mb-1 text-sm font-medium text-fg">About</p>
				<p className="text-xs text-fg-subtle">Version 1.0.0 · built today</p>
			</div>
		</SettingsShell>
	);
}

/** Advanced: future-scope stub plus the About / version block. */
export const Advanced: Story = {
	render: () => <AdvancedPage />,
};
