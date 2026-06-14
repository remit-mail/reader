import {
	mailboxOperationsListMailboxesOptions,
	outboxOperationsListOutboxMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import {
	BellOff,
	ChevronDown,
	ChevronRight,
	Send,
	Settings,
	Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { SignOutMenuItem } from "@/auth/SignOutMenuItem";
import { ErrorState } from "@/components/ui/ErrorState";
import {
	isFolderSectionCollapsed,
	setFolderSectionCollapsed,
} from "@/lib/folder-section-state";
import {
	filterDuplicateSpecialUse,
	getMailboxDisplayName as getDisplayName,
	getMailboxPriority,
	isSystemMailbox,
} from "@/lib/mailbox-order";
import { isOutboxListRow } from "@/lib/outbox-status";
import { cn } from "@/lib/utils";
import { MailboxItem } from "./MailboxItem";

interface MailSidebarProps {
	accounts: RemitImapAccountResponse[];
	/**
	 * Fires after the user clicks an inbox / outbox / draft entry. The
	 * mobile drawer wires this to `setDrawerOpen(false)` so the sidebar
	 * auto-collapses on selection (#199). Desktop callers omit it.
	 */
	onMailboxSelect?: () => void;
	/**
	 * Drawer (mobile) variant renders the nav body only, leaving the host
	 * drawer to supply its own footer. Desktop renders the full
	 * Apple-Mail-style sidebar: nav body that fills, plus a Settings +
	 * sign-out footer pinned to the bottom (#422).
	 */
	variant?: "desktop" | "drawer";
}

const startsWithDigit = (str: string): boolean => /^\d/.test(str);

const compareLabelNames = (a: string, b: string): number => {
	const aStartsWithDigit = startsWithDigit(a);
	const bStartsWithDigit = startsWithDigit(b);

	if (aStartsWithDigit && !bStartsWithDigit) return -1;
	if (!aStartsWithDigit && bStartsWithDigit) return 1;

	return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
};

const sortMailboxes = (
	mailboxes: RemitImapMailboxResponse[],
): {
	system: RemitImapMailboxResponse[];
	labels: RemitImapMailboxResponse[];
} => {
	const filtered = filterDuplicateSpecialUse(mailboxes);

	const system: RemitImapMailboxResponse[] = [];
	const labels: RemitImapMailboxResponse[] = [];

	for (const mailbox of filtered) {
		if (isSystemMailbox(mailbox.fullPath, mailbox.specialUse)) {
			system.push(mailbox);
		} else {
			labels.push(mailbox);
		}
	}

	system.sort(
		(a, b) =>
			getMailboxPriority(a.fullPath, a.specialUse) -
			getMailboxPriority(b.fullPath, b.specialUse),
	);
	labels.sort((a, b) =>
		compareLabelNames(getDisplayName(a.fullPath), getDisplayName(b.fullPath)),
	);

	return { system, labels };
};

const MAX_VISIBLE_LABELS = 13;

interface SelectableProps {
	onSelect?: () => void;
}

const OutboxLink = ({ onSelect }: SelectableProps) => {
	const location = useLocation();
	const isSelected = location.pathname.startsWith("/mail/outbox");

	const { data: outboxResponse } = useQuery(
		outboxOperationsListOutboxMessagesOptions(),
	);

	const pendingCount = useMemo(
		() =>
			(outboxResponse?.items ?? []).filter((item) =>
				isOutboxListRow(item.status),
			).length,
		[outboxResponse?.items],
	);

	return (
		<Link
			to="/mail/outbox"
			// Outbox has no search query; start clean so a stale ?q= from the
			// mailbox view doesn't leak across the sidebar navigation.
			search={{}}
			onClick={() => onSelect?.()}
			className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors hover:bg-surface-raised ${
				isSelected ? "bg-accent-2-soft font-medium" : ""
			}`}
		>
			<Send className="size-4 shrink-0" />
			<span className="flex-1 truncate">Outbox</span>
			{pendingCount > 0 && (
				<span className="text-xs font-normal bg-surface-sunken px-1.5 py-0.5 rounded-full">
					{pendingCount}
				</span>
			)}
		</Link>
	);
};

const AccountSection = ({
	account,
	onSelect,
}: { account: RemitImapAccountResponse } & SelectableProps) => {
	const [expanded, setExpanded] = useState(true);
	const [labelsExpanded, setLabelsExpanded] = useState(false);
	// Custom-folders section collapse persists per account (#643): an account
	// with many folders shouldn't keep pushing the system block out of view on
	// every reload. Lazy-init from storage so the first paint matches the
	// stored choice. Folders open = section not collapsed.
	const [foldersOpen, setFoldersOpen] = useState(
		() => !isFolderSectionCollapsed(account.accountId),
	);
	const toggleFolders = () => {
		setFoldersOpen((open) => {
			const next = !open;
			setFolderSectionCollapsed(account.accountId, !next);
			return next;
		});
	};
	const params = useParams({ strict: false });
	const selectedMailboxId = params.mailboxId as string | undefined;
	// Account-level mute (#433): the whole account is excluded from unified
	// views but keeps syncing. Render dimmed with a mute glyph (#422). The
	// brief issue wires the actual exclusion; this is presentation only.
	const accountMuted = Boolean(account.muted);

	const {
		data: mailboxesResponse,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		...mailboxOperationsListMailboxesOptions({
			path: { accountId: account.accountId },
		}),
		// Mailboxes change rarely (only on add/rename/delete). Cache forever
		// and rely on explicit invalidation from those mutations. Avoids the
		// 30s background refetch that flashes the sidebar.
		staleTime: Infinity,
	});

	const { system, labels } = useMemo(
		() => sortMailboxes(mailboxesResponse?.items ?? []),
		[mailboxesResponse?.items],
	);

	return (
		<div className={cn("mb-4", accountMuted && "opacity-55")}>
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-1 px-2 py-1 text-2xs font-semibold text-fg-subtle uppercase tracking-wider hover:text-fg transition-colors"
			>
				{expanded ? (
					<ChevronDown className="h-3 w-3 shrink-0" />
				) : (
					<ChevronRight className="h-3 w-3 shrink-0" />
				)}
				<span className="truncate">{account.email}</span>
				{accountMuted && (
					<BellOff
						className="size-3 shrink-0 text-fg-subtle"
						aria-label="Muted account"
					/>
				)}
			</button>
			{expanded && (
				<>
					{isLoading ? (
						<div className="px-3 py-2 text-sm text-fg-muted">Loading...</div>
					) : isError ? (
						<div className="px-3 py-2">
							<ErrorState
								variant="inline"
								title="Couldn't load mailboxes"
								error={error}
								onRetry={() => refetch()}
							/>
						</div>
					) : system.length === 0 && labels.length === 0 ? (
						<div className="px-3 py-2 text-sm text-fg-muted">No mailboxes</div>
					) : (
						<>
							<div className="space-y-0.5">
								{system.map((mailbox) => (
									<MailboxItem
										key={mailbox.mailboxId}
										mailbox={mailbox}
										isSelected={selectedMailboxId === mailbox.mailboxId}
										onSelect={onSelect}
									/>
								))}
								<OutboxLink onSelect={onSelect} />
							</div>
							{labels.length > 0 && (
								<>
									<div className="my-2 mx-3 border-t border-line" />
									<button
										type="button"
										onClick={toggleFolders}
										aria-expanded={foldersOpen}
										className="w-full flex items-center gap-1 px-2 py-1 text-2xs font-semibold text-fg-subtle uppercase tracking-wider hover:text-fg transition-colors"
									>
										{foldersOpen ? (
											<ChevronDown className="h-3 w-3 shrink-0" />
										) : (
											<ChevronRight className="h-3 w-3 shrink-0" />
										)}
										<span className="flex-1 text-left">Labels</span>
										<span className="tabular-nums opacity-70">
											{labels.length}
										</span>
									</button>
									{foldersOpen && (
										<div className="space-y-0.5">
											{(labelsExpanded
												? labels
												: labels.slice(0, MAX_VISIBLE_LABELS)
											).map((mailbox) => (
												<MailboxItem
													key={mailbox.mailboxId}
													mailbox={mailbox}
													isSelected={selectedMailboxId === mailbox.mailboxId}
													onSelect={onSelect}
												/>
											))}
											{labels.length > MAX_VISIBLE_LABELS && (
												<button
													type="button"
													onClick={() => setLabelsExpanded(!labelsExpanded)}
													className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-fg-muted hover:text-fg hover:bg-surface-raised rounded-md transition-colors"
												>
													{labelsExpanded ? (
														<>
															<ChevronDown className="size-4 shrink-0" />
															<span>Less</span>
														</>
													) : (
														<>
															<ChevronRight className="size-4 shrink-0" />
															<span>
																More ({labels.length - MAX_VISIBLE_LABELS})
															</span>
														</>
													)}
												</button>
											)}
										</div>
									)}
								</>
							)}
						</>
					)}
				</>
			)}
		</div>
	);
};

/**
 * Unified "Daily brief" entry — the first nav item per the 4-pane model
 * (#422). Until the brief issue lands it routes to the existing unified
 * mailbox view (`/mail`), which resolves to the user's primary inbox.
 */
const DailyBriefLink = ({ onSelect }: SelectableProps) => {
	const location = useLocation();
	// Active only on the bare unified entry, not on a specific mailbox.
	const isSelected =
		location.pathname === "/mail" || location.pathname === "/mail/";

	return (
		<Link
			to="/mail"
			search={{}}
			onClick={() => onSelect?.()}
			className={cn(
				"flex items-center gap-2 px-3 py-1.5 mb-2 text-sm rounded-md transition-colors hover:bg-surface-raised",
				isSelected
					? "bg-accent-2-soft font-medium text-accent-2"
					: "text-fg-muted",
			)}
		>
			<Sparkles className="size-4 shrink-0" />
			<span className="flex-1 truncate">Daily brief</span>
		</Link>
	);
};

/**
 * Pane 1 of the 4-pane shell: the navigation sidebar. Apple-Mail-style —
 * no toolbar, nav content starts at the top of the pane; the pane's
 * full-height right hairline anchors the datum line of the panes beside
 * it (#422). "Daily brief" first, then accounts with their mailboxes,
 * Settings + sign-out in the footer. No compose button squats here —
 * compose lives as the ✎ icon in the message toolbar.
 */
export const MailSidebar = ({
	accounts,
	onMailboxSelect,
	variant = "desktop",
}: MailSidebarProps) => {
	const location = useLocation();
	const settingsSelected = location.pathname.startsWith("/settings");

	const navBody = (
		<nav className="flex-1 overflow-y-auto py-2" aria-label="Mailboxes">
			<DailyBriefLink onSelect={onMailboxSelect} />
			{accounts.length === 0 ? (
				<div className="px-3 py-4 text-sm text-fg-muted text-center">
					No accounts configured
				</div>
			) : (
				accounts.map((account) => (
					<AccountSection
						key={account.accountId}
						account={account}
						onSelect={onMailboxSelect}
					/>
				))
			)}
		</nav>
	);

	// Drawer (mobile) hosts its own footer (sign-out) — render the nav body
	// only so the existing drawer plumbing is untouched.
	if (variant === "drawer") {
		return navBody;
	}

	return (
		<aside className="flex h-full w-full flex-col bg-surface-sunken">
			{navBody}
			<div className="border-t border-line px-2 py-2">
				<Link
					to="/settings/accounts"
					onClick={() => onMailboxSelect?.()}
					className={cn(
						"flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
						settingsSelected
							? "bg-accent-2-soft font-medium text-accent-2"
							: "text-fg-muted hover:bg-surface hover:text-fg",
					)}
				>
					<Settings className="size-4 shrink-0" />
					<span className="flex-1 truncate text-left">Settings</span>
				</Link>
				<SignOutMenuItem variant="drawer" showEmail />
			</div>
		</aside>
	);
};
