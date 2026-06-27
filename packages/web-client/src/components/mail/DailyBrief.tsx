/**
 * DailyBrief — unified cross-account message digest.
 *
 * Renders one section per message category (Flagged, then Personal /
 * Transactional / Newsletter / Marketing / Social / Automated) from the
 * GET /threads endpoint. The brief defaults to the cross-account aggregate;
 * the shared `MailHeader` + `FilterSheet` expando (via `MailViewChrome`) own
 * the title, unread count, search, and the category / Unread-Flagged / account
 * filters. Account switching also lives in the nav sidebar — the account source
 * group only appears here when more than one account feeds the brief.
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
	Avatar,
	BriefSection,
	briefFilterConfig,
	ComfortableRowTextContent,
	cn,
	comfortableRowClass,
	type FilterAccount,
	KeyboardHintBar,
	type ThreadRowData,
	type ThreadSection,
} from "@remit/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { sortAccountsByCreatedAt } from "@/lib/account-order";
import {
	groupBriefSections,
	matchesBriefSearch,
	toThreadRowData,
} from "@/lib/brief";
import { isFatalServerError } from "@/lib/error-classifier";
import { useMailContext } from "@/lib/mail-context";
import { MailViewChrome } from "./MailViewChrome";

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
// Filter predicates — the brief preset offers Unread + Flagged.
// ---------------------------------------------------------------------------

const FILTER_PREDICATES: Record<string, (t: ThreadRowData) => boolean> = {
	unread: (t) => !t.isRead,
	flagged: (t) => t.starred === true,
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
	const isDesktop = useIsDesktop();

	const nonMuted = useMemo(
		() => sortAccountsByCreatedAt(accounts.filter((a) => !a.muted?.value)),
		[accounts],
	);

	// "all" = the cross-account aggregate (the brief's default). Account
	// switching also lives in the nav sidebar; this source group is a convenience
	// shown only when more than one account feeds the brief.
	const [selectedAccountId, setSelectedAccountId] = useState("all");
	const [selectedCategory, setSelectedCategory] = useState("all");
	const [activeFilters, setActiveFilters] = useState<ReadonlySet<string>>(
		new Set(),
	);

	const toggleFilter = useCallback((id: string) => {
		setActiveFilters((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const clearFilters = useCallback(() => {
		setSelectedCategory("all");
		setActiveFilters(new Set());
		setSelectedAccountId("all");
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

	// Build accountId → unseen map for source counts
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

	// Convert API rows to ThreadRowData, narrowing by the selected account, the
	// category, the active attribute filters and the free-text search. Grouping
	// (starred → Flagged, then per category) runs on the result.
	const filteredRows = useMemo<ThreadRowData[]>(() => {
		const raw = threadsData?.items ?? [];
		const predicates = Array.from(activeFilters)
			.map((id) => FILTER_PREDICATES[id])
			.filter((p): p is (t: ThreadRowData) => boolean => p != null);
		return raw
			.filter(
				(t) =>
					selectedAccountId === "all" ||
					(t.accountId ?? t.accountConfigId) === selectedAccountId,
			)
			.map(toThreadRowData)
			.filter(
				(t) =>
					(selectedCategory === "all" || t.category === selectedCategory) &&
					predicates.every((p) => p(t)) &&
					(!sq || matchesBriefSearch(t, sq)),
			);
	}, [threadsData, selectedAccountId, selectedCategory, activeFilters, sq]);

	const sections = useMemo<ThreadSection[]>(
		() => groupBriefSections(filteredRows),
		[filteredRows],
	);

	const accountSources = useMemo<FilterAccount[]>(() => {
		if (nonMuted.length <= 1) return [];
		return [
			{ id: "all", label: "All", active: selectedAccountId === "all" },
			...nonMuted.map((account) => ({
				id: account.accountId,
				label: account.email.split("@")[0] ?? account.email,
				count: unseenByAccount.get(account.accountId),
				active: selectedAccountId === account.accountId,
			})),
		];
	}, [nonMuted, unseenByAccount, selectedAccountId]);

	const preset = useMemo(
		() => briefFilterConfig(accountSources),
		[accountSources],
	);

	const totalUnseen = useMemo(
		() => Array.from(unseenByAccount.values()).reduce((a, b) => a + b, 0),
		[unseenByAccount],
	);

	const hasFilters =
		selectedCategory !== "all" ||
		activeFilters.size > 0 ||
		selectedAccountId !== "all" ||
		sq.length > 0;

	return (
		<MailViewChrome
			title="Daily brief"
			unreadCount={totalUnseen}
			preset={preset}
			selectedCategory={selectedCategory}
			activeFilters={activeFilters}
			onSelectCategory={setSelectedCategory}
			onToggleFilter={toggleFilter}
			onSelectSource={setSelectedAccountId}
			onClearFilters={clearFilters}
			footer={isDesktop ? <KeyboardHintBar /> : undefined}
		>
			{failedAccounts.map((account) => (
				<ErrorBanner
					key={account.accountId}
					accountEmail={account.email}
					accountId={account.accountId}
				/>
			))}

			{isLoading ? (
				<>
					<SectionSkeleton />
					<SectionSkeleton />
				</>
			) : isError ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-sm text-fg-muted">
					<AlertCircle className="size-8 text-danger" />
					<p>Couldn't load your messages</p>
					<button
						type="button"
						onClick={() => refetch()}
						className="flex items-center gap-1 text-accent underline text-xs"
					>
						<RefreshCw className="size-3.5" />
						Try again
					</button>
				</div>
			) : sections.length === 0 ? (
				hasFilters ? (
					<div className="px-row-inset py-6 text-center text-2xs text-fg-subtle">
						No threads match these filters.
					</div>
				) : (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center px-4">
						<Sparkles className="size-8 text-fg-subtle" />
						<p className="text-sm font-medium text-fg">You're caught up</p>
						<p className="text-xs text-fg-subtle">Nothing needs attention.</p>
					</div>
				)
			) : (
				sections.map((section) => (
					<BriefSection
						key={section.id}
						section={section}
						Row={BriefRow}
						selectedThreadId={selectedMessageId}
						onSelectThread={onSelectMessage}
					/>
				))
			)}
		</MailViewChrome>
	);
}
