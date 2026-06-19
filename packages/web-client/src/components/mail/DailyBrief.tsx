/**
 * DailyBrief — unified cross-account message digest.
 *
 * Renders the three attention sections (Needs attention / Flagged /
 * Everything else) from the GET /threads endpoint. Account chips filter
 * all sections to a single account; selection persists in sessionStorage
 * so it survives route navigation within the session.
 *
 * The category-pill / attribute-chip / capped-collapsible list body is the
 * shared `BriefSections` component from remit-ui — this file owns only the
 * brief-specific wiring: data fetching, account chips, error/loading/empty
 * states, search filtering, and a navigation-aware row.
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
	type BriefCategoryFilter,
	BriefSections,
	ComfortableRowTextContent,
	cn,
	comfortableRowClass,
	type ThreadRowData,
	type ThreadSection,
} from "@remit/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { sortAccountsByCreatedAt } from "@/lib/account-order";
import {
	buildBriefChips,
	countMutedAccounts,
	groupBriefSections,
	matchesBriefSearch,
	toThreadRowData,
} from "@/lib/brief";
import { isFatalServerError } from "@/lib/error-classifier";
import { useMailContext } from "@/lib/mail-context";

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

const ErrorBanner = ({ accountEmail }: ErrorBannerProps) => {
	const navigate = useNavigate();
	return (
		<div className="flex items-center gap-2 px-row-inset py-2 border-b border-line bg-danger-soft/40 text-xs text-danger">
			<AlertCircle className="size-3.5 shrink-0" />
			<span className="flex-1 truncate">{accountEmail} can't connect</span>
			<button
				type="button"
				onClick={() => navigate({ to: "/settings/accounts" })}
				className="shrink-0 underline text-danger hover:opacity-80"
			>
				Reconnect
			</button>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Brief row — a navigation-aware row satisfying remit-ui's BriefRowComponent
// ---------------------------------------------------------------------------

const BriefRow = ({
	thread,
	active,
	onClick,
}: {
	thread: ThreadRowData;
	active?: boolean;
	onClick?: () => void;
}) => {
	const unread = !thread.isRead;
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn("group w-full", comfortableRowClass({ active }))}
		>
			{unread && (
				<span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent" />
			)}
			<Avatar name={thread.fromName} email={thread.fromEmail} size="sm" />
			<ComfortableRowTextContent thread={thread} />
		</button>
	);
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DailyBriefProps {
	accounts: RemitImapAccountResponse[];
	selectedMessageId?: string;
	onSelectMessage?: (id: string) => void;
}

export function DailyBrief({
	accounts,
	selectedMessageId,
	onSelectMessage,
}: DailyBriefProps) {
	const { searchQuery } = useMailContext();

	const nonMuted = useMemo(
		() => sortAccountsByCreatedAt(accounts.filter((a) => !a.muted?.value)),
		[accounts],
	);
	const mutedCount = useMemo(() => countMutedAccounts(accounts), [accounts]);

	const [activeChipId, setActiveChipId] = useState<string | undefined>(
		readStoredChip,
	);
	const [briefCategory, setBriefCategory] =
		useState<BriefCategoryFilter>("all");

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

	// Per-account connection failures: accounts whose mailbox list failed for a
	// reason that is genuinely the account's (e.g. IMAP down, auth expired) — a
	// 4xx. A first-party 5xx is OUR API breaking, not the account being
	// unreachable, so it must NOT render the misleading "can't connect /
	// Reconnect" banner; the global escalation overlay (QueryCache.onError)
	// handles it instead.
	const failedAccounts = useMemo<RemitImapAccountResponse[]>(() => {
		return nonMuted.filter((_, i) => {
			const query = mailboxQueries[i];
			if (!query?.isError) return false;
			return !isFatalServerError(query.error);
		});
	}, [nonMuted, mailboxQueries]);

	const sq = searchQuery.trim().toLowerCase();

	// Convert API rows to ThreadRowData, narrowing by the account chip and the
	// free-text search. Category / attribute / cap filtering lives in
	// BriefSections, which receives these grouped sections.
	const filteredRows = useMemo<ThreadRowData[]>(() => {
		const raw = threadsData?.items ?? [];
		return raw
			.filter(
				(t) =>
					!activeChipId || (t.accountId ?? t.accountConfigId) === activeChipId,
			)
			.map(toThreadRowData)
			.filter((t) => !sq || matchesBriefSearch(t, sq));
	}, [threadsData, activeChipId, sq]);

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

			{/* Per-account error banners */}
			{failedAccounts.map((account) => (
				<ErrorBanner
					key={account.accountId}
					accountEmail={account.email}
					accountId={account.accountId}
				/>
			))}

			{/* Main scrollable body */}
			{isLoading ? (
				<div className="flex-1 overflow-y-auto">
					<SectionSkeleton />
					<SectionSkeleton />
				</div>
			) : isError ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-fg-muted">
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
			) : sections.length === 0 && !sq ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-2 text-center px-4">
					<Sparkles className="size-8 text-fg-subtle" />
					<p className="text-sm font-medium text-fg">You're caught up</p>
					<p className="text-xs text-fg-subtle">Nothing needs attention.</p>
				</div>
			) : (
				<BriefSections
					sections={sections}
					briefCategory={briefCategory}
					selectedThreadId={selectedMessageId}
					accountChips={chips}
					mutedNote={mutedNote}
					Row={BriefRow}
					onSelectThread={onSelectMessage}
					onSelectBriefCategory={setBriefCategory}
					onSelectAccountChip={handleChipClick}
				/>
			)}
		</section>
	);
}
