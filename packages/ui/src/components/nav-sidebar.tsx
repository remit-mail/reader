import {
	AlertCircle,
	AlertOctagon,
	Archive,
	BellOff,
	ChevronDown,
	ChevronRight,
	FileText,
	Folder,
	Inbox,
	Mails,
	Send,
	Sparkles,
	Star,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "../lib/cn.js";
import type {
	AppShellProps,
	NavAccount,
	NavLinkComponent,
	NavMailbox,
	NavMailboxRole,
} from "./app-shell-types.js";

/* ------------------------------------------------------------------ */
/* Pane 1: navigation sidebar                                         */
/* ------------------------------------------------------------------ */

function navItemClassName({
	active,
	dimmed,
	indent,
}: {
	active?: boolean;
	dimmed?: boolean;
	indent?: boolean;
}): string {
	return cn(
		"flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors",
		indent && "pl-7",
		active
			? "bg-accent-2-soft font-medium text-accent-2"
			: "text-fg-muted hover:bg-surface hover:text-fg",
		dimmed && "opacity-55",
	);
}

function NavItemInner({
	icon,
	label,
	count,
	active,
}: {
	icon?: ReactNode;
	label: string;
	count?: number;
	active?: boolean;
}) {
	return (
		<>
			{icon && (
				<span
					className={cn(
						"shrink-0",
						active ? "text-accent-2" : "text-fg-subtle",
					)}
				>
					{icon}
				</span>
			)}
			<span className="flex-1 truncate">{label}</span>
			{count != null && count > 0 && (
				<span
					className={cn(
						"text-2xs tabular-nums",
						active ? "text-accent-2" : "text-fg-subtle",
					)}
				>
					{count}
				</span>
			)}
		</>
	);
}

/**
 * A navigation entry. Renders a real anchor through `linkComponent` when given a
 * `navId` (preserving middle-click / deep-link / link a11y); otherwise a button
 * with programmatic `onClick`. Non-navigational toggles never pass a navId.
 */
function NavItem({
	icon,
	label,
	count,
	active,
	dimmed,
	indent,
	navId,
	linkComponent,
	ariaLabel,
	title,
	onClick,
}: {
	icon?: ReactNode;
	label: string;
	count?: number;
	active?: boolean;
	dimmed?: boolean;
	indent?: boolean;
	navId?: string;
	linkComponent?: NavLinkComponent;
	ariaLabel?: string;
	title?: string;
	onClick?: () => void;
}) {
	const className = navItemClassName({ active, dimmed, indent });
	const inner = (
		<NavItemInner icon={icon} label={label} count={count} active={active} />
	);

	if (navId && linkComponent) {
		return linkComponent({
			navId,
			className,
			ariaLabel: ariaLabel ?? label,
			title,
			onClick,
			children: inner,
		});
	}

	return (
		<button
			type="button"
			onClick={onClick}
			className={className}
			aria-label={ariaLabel}
			title={title}
		>
			{inner}
		</button>
	);
}

/* System mailboxes render in a fixed, scannable order; a mailbox with no `role`
   is a custom folder shown under a collapsible header. The role is the single
   detection result computed by the web-client adapter — the kit never parses
   raw IMAP SPECIAL-USE strings. Order matches the adapter's canonical priority
   (Inbox, Flagged, Drafts, Sent, Archive, All, Junk, Trash). */
const ROLE_ORDER: Record<NavMailboxRole, number> = {
	inbox: 0,
	flagged: 1,
	drafts: 2,
	sent: 3,
	archive: 4,
	all: 5,
	junk: 6,
	trash: 7,
};

function roleIcon(role: NavMailboxRole): ReactNode {
	switch (role) {
		case "inbox":
			return <Inbox className="size-4" />;
		case "flagged":
			return <Star className="size-4" />;
		case "drafts":
			return <FileText className="size-4" />;
		case "sent":
			return <Send className="size-4" />;
		case "archive":
			return <Archive className="size-4" />;
		case "all":
			return <Mails className="size-4" />;
		case "junk":
			return <AlertOctagon className="size-4" />;
		case "trash":
			return <Trash2 className="size-4" />;
	}
}

const hasRole = (mb: NavMailbox): mb is NavMailbox & { role: NavMailboxRole } =>
	mb.role != null;

const FOLDER_COLLAPSE_THRESHOLD = 8;

const FOLDER_OPEN_KEY = "remit.nav.folders.open.";
const ACCOUNT_OPEN_KEY = "remit.nav.account.open.";

/**
 * Read a persisted open/closed flag. `fallback` applies only when nothing is
 * stored yet. Both the account section and the custom-folders section default
 * open: the folders list is independently capped at FOLDER_COLLAPSE_THRESHOLD
 * with a "Show all", so an open section never pushes the system block far off
 * screen — making default-open the more discoverable choice.
 *
 * Exported for unit testing the persistence contract.
 */
export function readOpen(
	prefix: string,
	id: string,
	fallback: boolean,
): boolean {
	if (typeof localStorage === "undefined") return fallback;
	const stored = localStorage.getItem(prefix + id);
	if (stored === null) return fallback;
	return stored !== "0";
}

export function writeOpen(prefix: string, id: string, open: boolean): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(prefix + id, open ? "1" : "0");
}

export const NAV_FOLDER_OPEN_KEY = FOLDER_OPEN_KEY;
export const NAV_ACCOUNT_OPEN_KEY = ACCOUNT_OPEN_KEY;

function AccountNav({
	account,
	selectedNavId,
	onSelectNav,
	linkComponent,
}: {
	account: NavAccount;
	selectedNavId: string;
	onSelectNav?: (id: string) => void;
	linkComponent?: NavLinkComponent;
}) {
	const [accountOpen, setAccountOpen] = useState(() =>
		readOpen(ACCOUNT_OPEN_KEY, account.id, true),
	);
	const [foldersOpen, setFoldersOpen] = useState(() =>
		readOpen(FOLDER_OPEN_KEY, account.id, true),
	);
	const [showAllFolders, setShowAllFolders] = useState(false);

	const toggleAccount = () => {
		setAccountOpen((open) => {
			const next = !open;
			writeOpen(ACCOUNT_OPEN_KEY, account.id, next);
			return next;
		});
	};

	const toggleFolders = () => {
		setFoldersOpen((open) => {
			const next = !open;
			writeOpen(FOLDER_OPEN_KEY, account.id, next);
			return next;
		});
	};

	const system = account.mailboxes
		.filter(hasRole)
		.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
	const folders = account.mailboxes.filter((mb) => !hasRole(mb));
	const visibleFolders =
		showAllFolders || folders.length <= FOLDER_COLLAPSE_THRESHOLD
			? folders
			: folders.slice(0, FOLDER_COLLAPSE_THRESHOLD);
	const hiddenCount = folders.length - visibleFolders.length;

	const status = account.status ?? "ready";
	const isEmpty =
		status === "ready" && system.length === 0 && folders.length === 0;

	return (
		<div className="mt-3">
			<button
				type="button"
				onClick={toggleAccount}
				aria-expanded={accountOpen}
				className={cn(
					"flex w-full items-center gap-1.5 px-2 pb-1 text-left transition-colors hover:text-fg",
					account.muted && "opacity-55",
				)}
			>
				{accountOpen ? (
					<ChevronDown className="size-3 shrink-0 text-fg-subtle" />
				) : (
					<ChevronRight className="size-3 shrink-0 text-fg-subtle" />
				)}
				<span className="truncate text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
					{account.label}
				</span>
				{account.muted && (
					<>
						<BellOff className="size-3 shrink-0 text-fg-subtle" />
						<span className="text-2xs text-fg-subtle">muted</span>
					</>
				)}
			</button>

			{accountOpen && (
				<>
					{status === "loading" && (
						<div className="px-2 py-1 text-sm text-fg-muted">Loading…</div>
					)}

					{status === "error" && (
						<div
							role="alert"
							className="mx-2 my-1 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-sm"
						>
							<AlertCircle
								className="mt-0.5 size-4 shrink-0 text-danger"
								aria-hidden="true"
							/>
							<div className="min-w-0 flex-1">
								<p className="font-medium text-danger">
									Couldn't load mailboxes
								</p>
							</div>
							{account.onRetry && (
								<button
									type="button"
									onClick={account.onRetry}
									className="shrink-0 text-sm font-medium text-accent hover:underline"
								>
									Retry
								</button>
							)}
						</div>
					)}

					{isEmpty && (
						<div className="px-2 py-1 text-sm text-fg-muted">No mailboxes</div>
					)}

					{status === "ready" && (
						<>
							{system.map((mb) => (
								<NavItem
									key={mb.id}
									navId={mb.id}
									linkComponent={linkComponent}
									icon={roleIcon(mb.role)}
									label={mb.name}
									ariaLabel={mb.name}
									title={mb.fullPath ?? mb.name}
									count={mb.unseen}
									active={selectedNavId === mb.id}
									dimmed={account.muted}
									onClick={() => onSelectNav?.(mb.id)}
								/>
							))}

							{account.outboxPending !== undefined && (
								<NavItem
									navId="outbox"
									linkComponent={linkComponent}
									icon={<Send className="size-4" />}
									label="Outbox"
									ariaLabel="Outbox"
									count={
										account.outboxPending > 0
											? account.outboxPending
											: undefined
									}
									active={selectedNavId === "outbox"}
									dimmed={account.muted}
									onClick={() => onSelectNav?.("outbox")}
								/>
							)}

							{folders.length > 0 && (
								<>
									<button
										type="button"
										onClick={toggleFolders}
										aria-expanded={foldersOpen}
										className="mt-1 flex w-full items-center gap-1 px-2 py-1 text-left text-2xs font-semibold uppercase tracking-wider text-fg-subtle transition-colors hover:text-fg"
									>
										{foldersOpen ? (
											<ChevronDown className="size-3 shrink-0" />
										) : (
											<ChevronRight className="size-3 shrink-0" />
										)}
										<span className="flex-1">Folders</span>
										<span className="tabular-nums opacity-70">
											{folders.length}
										</span>
									</button>
									{foldersOpen && (
										<>
											{visibleFolders.map((mb) => (
												<NavItem
													key={mb.id}
													navId={mb.id}
													linkComponent={linkComponent}
													icon={<Folder className="size-4" />}
													label={mb.name}
													ariaLabel={mb.name}
													title={mb.fullPath ?? mb.name}
													count={mb.unseen}
													active={selectedNavId === mb.id}
													dimmed={account.muted}
													onClick={() => onSelectNav?.(mb.id)}
												/>
											))}
											{(hiddenCount > 0 || showAllFolders) &&
												folders.length > FOLDER_COLLAPSE_THRESHOLD && (
													<button
														type="button"
														onClick={() => setShowAllFolders((all) => !all)}
														className="ml-7 flex items-center px-2 py-1 text-2xs font-medium text-accent transition-colors hover:underline"
													>
														{showAllFolders
															? "Show less"
															: `Show all (${folders.length})`}
													</button>
												)}
										</>
									)}
								</>
							)}
						</>
					)}
				</>
			)}
		</div>
	);
}

export interface NavSidebarProps
	extends Pick<
		AppShellProps,
		"accounts" | "selectedNavId" | "briefUnseen" | "onSelectNav"
	> {
	/**
	 * "desktop" (default) wraps the nav in a full-height aside — the Pane 1
	 * column in the 4-pane shell. "drawer" renders the nav body only, letting
	 * the mobile Drawer panel be the outer container.
	 */
	variant?: "desktop" | "drawer";
	/**
	 * Renders each navigation entry as a real anchor (router `<Link>`). Omit to
	 * fall back to programmatic buttons (static stories / AppShell preview).
	 */
	linkComponent?: NavLinkComponent;
}

export function NavSidebar({
	accounts,
	selectedNavId,
	briefUnseen,
	onSelectNav,
	variant = "desktop",
	linkComponent,
}: NavSidebarProps) {
	const navBody = (
		<nav
			className={
				variant === "drawer" ? "px-2 py-2" : "flex-1 overflow-y-auto px-2 py-2"
			}
			aria-label="Mailboxes"
		>
			<NavItem
				navId="brief"
				linkComponent={linkComponent}
				icon={<Sparkles className="size-4" />}
				label="Daily brief"
				ariaLabel="Daily brief"
				count={briefUnseen}
				active={selectedNavId === "brief"}
				onClick={() => onSelectNav?.("brief")}
			/>

			<NavItem
				navId="flagged"
				linkComponent={linkComponent}
				icon={<Star className="size-4" />}
				label="Flagged"
				ariaLabel="Flagged"
				active={selectedNavId === "flagged"}
				onClick={() => onSelectNav?.("flagged")}
			/>

			{accounts.length === 0 ? (
				<div className="px-2 py-4 text-center text-sm text-fg-muted">
					No accounts configured
				</div>
			) : (
				accounts.map((account) => (
					<AccountNav
						key={account.id}
						account={account}
						selectedNavId={selectedNavId}
						onSelectNav={onSelectNav}
						linkComponent={linkComponent}
					/>
				))
			)}
		</nav>
	);

	if (variant === "drawer") return navBody;

	return (
		<aside className="flex h-full w-full flex-col bg-surface-sunken">
			{/* no toolbar over the sidebar (Apple Mail-style): nav content
			    starts at the top; the datum bar exists only over the
			    list/reading/intelligence panes */}
			{navBody}
		</aside>
	);
}
