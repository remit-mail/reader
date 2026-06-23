import {
	AlertOctagon,
	Archive,
	BellOff,
	ChevronDown,
	ChevronRight,
	FileText,
	Folder,
	Inbox,
	Send,
	Settings,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn.js";
import type {
	AppShellProps,
	MailboxSpecialUse,
	NavAccount,
	NavMailbox,
} from "./app-shell-types.js";

/* ------------------------------------------------------------------ */
/* Pane 1: navigation sidebar                                         */
/* ------------------------------------------------------------------ */

function NavItem({
	icon,
	label,
	count,
	active,
	dimmed,
	indent,
	onClick,
}: {
	icon?: React.ReactNode;
	label: string;
	count?: number;
	active?: boolean;
	dimmed?: boolean;
	indent?: boolean;
	onClick?: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors",
				indent && "pl-7",
				active
					? "bg-accent-2-soft font-medium text-accent-2"
					: "text-fg-muted hover:bg-surface hover:text-fg",
				dimmed && "opacity-55",
			)}
		>
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
		</button>
	);
}

/* System mailboxes render in a fixed, scannable order; everything without a
   special-use attribute is a custom folder shown under a collapsible header.
   Inbox has no special-use attribute (matched by name per RFC 6154). */
const systemOrder: ReadonlyArray<MailboxSpecialUse | "INBOX"> = [
	"INBOX",
	"\\Drafts",
	"\\Sent",
	"\\Archive",
	"\\Junk",
	"\\Trash",
];

function systemKind(mb: NavMailbox): MailboxSpecialUse | "INBOX" | null {
	if (mb.specialUse && mb.specialUse.length > 0) return mb.specialUse[0];
	if (mb.name === "Inbox") return "INBOX";
	return null;
}

function systemIcon(kind: MailboxSpecialUse | "INBOX") {
	if (kind === "INBOX") return <Inbox className="size-4" />;
	if (kind === "\\Drafts") return <FileText className="size-4" />;
	if (kind === "\\Sent") return <Send className="size-4" />;
	if (kind === "\\Archive") return <Archive className="size-4" />;
	if (kind === "\\Junk") return <AlertOctagon className="size-4" />;
	if (kind === "\\Trash") return <Trash2 className="size-4" />;
	return <Folder className="size-4" />;
}

const FOLDER_COLLAPSE_THRESHOLD = 8;

function AccountNav({
	account,
	selectedNavId,
	onSelectNav,
}: {
	account: NavAccount;
	selectedNavId: string;
	onSelectNav?: (id: string) => void;
}) {
	const [foldersOpen, setFoldersOpen] = useState(true);
	const [showAllFolders, setShowAllFolders] = useState(false);

	const system = account.mailboxes
		.filter((mb) => systemKind(mb) !== null)
		.sort(
			(a, b) =>
				systemOrder.indexOf(systemKind(a) as MailboxSpecialUse | "INBOX") -
				systemOrder.indexOf(systemKind(b) as MailboxSpecialUse | "INBOX"),
		);
	const folders = account.mailboxes.filter((mb) => systemKind(mb) === null);
	const visibleFolders =
		showAllFolders || folders.length <= FOLDER_COLLAPSE_THRESHOLD
			? folders
			: folders.slice(0, FOLDER_COLLAPSE_THRESHOLD);
	const hiddenCount = folders.length - visibleFolders.length;

	return (
		<div className="mt-3">
			<div
				className={cn(
					"flex items-center gap-1.5 px-2 pb-1",
					account.muted && "opacity-55",
				)}
			>
				<span className="truncate text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
					{account.label}
				</span>
				{account.muted && (
					<>
						<BellOff className="size-3 shrink-0 text-fg-subtle" />
						<span className="text-2xs text-fg-subtle">muted</span>
					</>
				)}
			</div>

			{system.map((mb) => (
				<NavItem
					key={mb.id}
					icon={systemIcon(systemKind(mb) as MailboxSpecialUse | "INBOX")}
					label={mb.name}
					count={mb.unseen}
					active={selectedNavId === mb.id}
					dimmed={account.muted}
					onClick={() => onSelectNav?.(mb.id)}
				/>
			))}

			{folders.length > 0 && (
				<>
					<button
						type="button"
						onClick={() => setFoldersOpen((open) => !open)}
						className="mt-1 flex w-full items-center gap-1 px-2 py-1 text-left text-2xs font-semibold uppercase tracking-wider text-fg-subtle transition-colors hover:text-fg"
					>
						{foldersOpen ? (
							<ChevronDown className="size-3 shrink-0" />
						) : (
							<ChevronRight className="size-3 shrink-0" />
						)}
						<span className="flex-1">Folders</span>
						<span className="tabular-nums opacity-70">{folders.length}</span>
					</button>
					{foldersOpen && (
						<>
							{visibleFolders.map((mb) => (
								<NavItem
									key={mb.id}
									icon={<Folder className="size-4" />}
									label={mb.name}
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
		</div>
	);
}

export function NavSidebar({
	accounts,
	selectedNavId,
	briefUnseen,
	onSelectNav,
}: Pick<
	AppShellProps,
	"accounts" | "selectedNavId" | "briefUnseen" | "onSelectNav"
>) {
	return (
		<aside className="flex h-full w-full flex-col bg-surface-sunken">
			{/* no toolbar over the sidebar (Apple Mail-style): nav content
			    starts at the top; the datum bar exists only over the
			    list/reading/intelligence panes */}
			<nav className="flex-1 overflow-y-auto px-2 py-2">
				<NavItem
					icon={<Sparkles className="size-4" />}
					label="Daily brief"
					count={briefUnseen}
					active={selectedNavId === "brief"}
					onClick={() => onSelectNav?.("brief")}
				/>

				{accounts.map((account) => (
					<AccountNav
						key={account.id}
						account={account}
						selectedNavId={selectedNavId}
						onSelectNav={onSelectNav}
					/>
				))}
			</nav>

			<div className="border-t border-line px-2 py-2">
				<NavItem icon={<Settings className="size-4" />} label="Settings" />
			</div>
		</aside>
	);
}
