/**
 * DailyBrief — unified cross-account message digest.
 *
 * Renders the three attention sections (Needs attention / Flagged /
 * Everything else) from the GET /threads endpoint. Account chips filter
 * all sections to a single account; selection persists in sessionStorage
 * so it survives route navigation within the session.
 *
 * Loading: skeleton rows on first paint, patch-in-place on refetch.
 * Error: per-section; the brief still renders other sections.
 * Empty: "You're caught up" message.
 */
import {
	mailboxOperationsListMailboxesOptions,
	unifiedThreadOperationsListAllThreadsOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import {
	type AccountChip,
	Avatar,
	ComfortableRowTextContent,
	cn,
	comfortableRowClass,
	type ThreadRowData,
	type ThreadSection,
} from "@remit/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { sortAccountsByCreatedAt } from "@/lib/account-order";
import {
	buildBriefChips,
	countMutedAccounts,
	groupBriefSections,
	toThreadRowData,
} from "@/lib/brief";

const CHIP_STORAGE_KEY = "remit:brief-chip";

function readStoredChip(): string | undefined {
	try {
		return sessionStorage.getItem(CHIP_STORAGE_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

function writeStoredChip(id: string | undefined): void {
	try {
		if (id === undefined) {
			sessionStorage.removeItem(CHIP_STORAGE_KEY);
		} else {
			sessionStorage.setItem(CHIP_STORAGE_KEY, id);
		}
	} catch {
		// sessionStorage unavailable — silently ignore
	}
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

const SectionSkeleton = () => (
	<div className="animate-pulse">
		{Array.from({ length: 3 }).map((_, i) => (
			<div
				// biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows have no stable id
				key={i}
				className="flex items-start gap-3 py-2 pl-5 pr-4 border-b border-line"
			>
				<div className="size-7 rounded-full bg-surface-sunken shrink-0 mt-0.5" />
				<div className="flex-1 space-y-1.5">
					<div className="flex justify-between gap-2">
						<div className="h-3.5 bg-surface-sunken rounded w-28" />
						<div className="h-3 bg-surface-sunken rounded w-12" />
					</div>
					<div className="h-3.5 bg-surface-sunken rounded w-48" />
					<div className="h-3 bg-surface-sunken rounded w-full" />
				</div>
			</div>
		))}
	</div>
);

// ---------------------------------------------------------------------------
// Error banner (per-account connection failure)
// ---------------------------------------------------------------------------

interface ErrorBannerProps {
	accountEmail: string;
	accountId: string;
}

const ErrorBanner = ({ accountEmail }: ErrorBannerProps) => (
	<div className="flex items-center gap-2 px-row-inset py-2 border-b border-line bg-danger-soft/40 text-xs text-danger">
		<AlertCircle className="size-3.5 shrink-0" />
		<span className="flex-1 truncate">{accountEmail} can't connect</span>
		<Link
			to="/settings/accounts"
			className="shrink-0 underline text-danger hover:opacity-80"
		>
			Reconnect
		</Link>
	</div>
);

// ---------------------------------------------------------------------------
// Brief row — links to the mailbox where the thread lives
// ---------------------------------------------------------------------------

interface BriefRowProps {
	row: ThreadRowData;
	mailboxId: string;
	isSelected: boolean;
}

const BriefRow = ({ row, mailboxId, isSelected }: BriefRowProps) => {
	const unread = !row.isRead;
	return (
		<Link
			to="/mail/$mailboxId"
			params={{ mailboxId }}
			search={{ selectedMessageId: row.id }}
			className={cn("group", comfortableRowClass({ active: isSelected }))}
		>
			{unread && (
				<span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent" />
			)}
			<Avatar name={row.fromName} email={row.fromEmail} size="sm" />
			<ComfortableRowTextContent thread={row} />
		</Link>
	);
};

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

const SectionHeader = ({ label, count }: { label: string; count: number }) => (
	<div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-line bg-surface-sunken px-row-inset py-1">
		<span className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
			{label}
		</span>
		<span className="text-2xs text-fg-subtle tabular-nums">{count}</span>
	</div>
);

// ---------------------------------------------------------------------------
// Account chips row
// ---------------------------------------------------------------------------

interface ChipsRowProps {
	chips: AccountChip[];
	mutedNote: string | undefined;
	onChipClick: (id: string) => void;
}

const ChipsRow = ({ chips, mutedNote, onChipClick }: ChipsRowProps) => (
	<div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-row-inset py-1 shrink-0">
		{chips.map((chip) => (
			<button
				key={chip.id}
				type="button"
				onClick={() => onChipClick(chip.id)}
				className={cn(
					"flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs transition-colors",
					chip.active
						? "border-accent-2 bg-accent-2-soft font-medium text-accent-2"
						: "border-line text-fg-muted hover:border-line-strong",
				)}
			>
				{chip.label}
				{chip.count != null && chip.count > 0 && (
					<span className="tabular-nums opacity-70">{chip.count}</span>
				)}
			</button>
		))}
		{mutedNote && (
			<Link
				to="/settings/accounts"
				className="ml-auto shrink-0 text-2xs text-fg-subtle hover:text-fg"
			>
				{mutedNote}
			</Link>
		)}
	</div>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DailyBriefProps {
	accounts: RemitImapAccountResponse[];
	selectedMessageId?: string;
}

/**
 * Builds a map from messageId → mailboxId from all loaded mailboxes.
 * We don't have it on the thread row directly, so we fall back to the
 * mailboxId from the `RemitImapThreadMessageResponse` (which does carry
 * `mailboxId`).
 */
export function DailyBrief({ accounts, selectedMessageId }: DailyBriefProps) {
	const nonMuted = useMemo(
		() => sortAccountsByCreatedAt(accounts.filter((a) => !a.muted?.value)),
		[accounts],
	);
	const mutedCount = useMemo(() => countMutedAccounts(accounts), [accounts]);

	const [activeChipId, setActiveChipId] = useState<string | undefined>(
		readStoredChip,
	);

	const handleChipClick = useCallback((id: string) => {
		const next = id === "all" ? undefined : id;
		setActiveChipId(next);
		writeStoredChip(next);
	}, []);

	// --- Unified threads query ---
	const {
		data: threadsData,
		isLoading,
		isError,
		refetch,
	} = useQuery({
		...unifiedThreadOperationsListAllThreadsOptions(),
		staleTime: 60_000,
	});

	// --- Per-account mailbox list for unread counts and error detection ---
	const mailboxQueries = useQueries({
		queries: nonMuted.map((account) => ({
			...mailboxOperationsListMailboxesOptions({
				path: { accountId: account.accountId },
			}),
			staleTime: Infinity,
		})),
	});

	// Build accountId → unseen map for chip counts
	const unseenByAccount = useMemo<Map<string, number>>(() => {
		const map = new Map<string, number>();
		for (let i = 0; i < nonMuted.length; i++) {
			const accountId = nonMuted[i].accountId;
			const mailboxes = mailboxQueries[i]?.data?.items ?? [];
			const total = mailboxes.reduce(
				(sum, mb) => sum + (mb.unseenCount ?? 0),
				0,
			);
			map.set(accountId, total);
		}
		return map;
	}, [nonMuted, mailboxQueries]);

	// Stale account detection: accounts with a mailbox query error
	const failedAccounts = useMemo<RemitImapAccountResponse[]>(() => {
		return nonMuted.filter((_, i) => mailboxQueries[i]?.isError);
	}, [nonMuted, mailboxQueries]);

	// Convert API rows to ThreadRowData, filtering by selected chip
	const filteredRows = useMemo<ThreadRowData[]>(() => {
		const raw = threadsData?.items ?? [];
		return raw
			.filter(
				(t) =>
					!activeChipId || (t.accountId ?? t.accountConfigId) === activeChipId,
			)
			.map(toThreadRowData);
	}, [threadsData, activeChipId]);

	const sections = useMemo<ThreadSection[]>(
		() => groupBriefSections(filteredRows),
		[filteredRows],
	);

	const chips = useMemo<AccountChip[]>(
		() => buildBriefChips(nonMuted, unseenByAccount, activeChipId),
		[nonMuted, unseenByAccount, activeChipId],
	);

	const totalUnseen = useMemo(
		() => Array.from(unseenByAccount.values()).reduce((a, b) => a + b, 0),
		[unseenByAccount],
	);

	const mutedNote = mutedCount > 0 ? `+${mutedCount} muted` : undefined;

	// Build a messageId → mailboxId lookup from the raw thread data
	const mailboxByMessageId = useMemo<Map<string, string>>(() => {
		const map = new Map<string, string>();
		for (const t of threadsData?.items ?? []) {
			map.set(t.messageId, t.mailboxId);
		}
		return map;
	}, [threadsData]);

	return (
		<section className="flex h-full w-full flex-col bg-surface">
			{/* Header */}
			<header className="flex h-pane-header shrink-0 items-center justify-between gap-2 border-b border-line px-row-inset">
				<h1 className="truncate text-sm font-semibold text-fg">Daily brief</h1>
				<div className="flex items-center gap-2">
					{totalUnseen > 0 && (
						<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
							{totalUnseen} unread
						</span>
					)}
					{isError && (
						<button
							type="button"
							onClick={() => refetch()}
							className="shrink-0 p-1 text-fg-subtle hover:text-fg rounded"
							aria-label="Retry"
						>
							<RefreshCw className="size-3.5" />
						</button>
					)}
				</div>
			</header>

			{/* Account chips — only when there are multiple non-muted accounts */}
			{chips.length > 1 && (
				<ChipsRow
					chips={chips}
					mutedNote={mutedNote}
					onChipClick={handleChipClick}
				/>
			)}

			{/* Per-account error banners */}
			{failedAccounts.map((account) => (
				<ErrorBanner
					key={account.accountId}
					accountEmail={account.email}
					accountId={account.accountId}
				/>
			))}

			{/* Main scrollable body */}
			<div className="flex-1 overflow-y-auto">
				{isLoading ? (
					<>
						<SectionSkeleton />
						<SectionSkeleton />
					</>
				) : isError ? (
					<div className="flex flex-col items-center justify-center h-full gap-3 text-sm text-fg-muted">
						<AlertCircle className="size-8 text-danger" />
						<p>Couldn't load your messages</p>
						<button
							type="button"
							onClick={() => refetch()}
							className="text-accent underline text-xs"
						>
							Try again
						</button>
					</div>
				) : sections.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
						<Sparkles className="size-8 text-fg-subtle" />
						<p className="text-sm font-medium text-fg">You're caught up</p>
						<p className="text-xs text-fg-subtle">Nothing needs attention.</p>
					</div>
				) : (
					sections.map((section) => (
						<div key={section.id}>
							{section.label && (
								<SectionHeader
									label={section.label}
									count={section.threads.length}
								/>
							)}
							<div className="divide-y divide-line">
								{section.threads.map((thread) => {
									const mailboxId = mailboxByMessageId.get(thread.id) ?? "";
									return (
										<BriefRow
											key={thread.id}
											row={thread}
											mailboxId={mailboxId}
											isSelected={thread.id === selectedMessageId}
										/>
									);
								})}
							</div>
						</div>
					))
				)}
			</div>
		</section>
	);
}
