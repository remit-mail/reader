/**
 * DailyBrief — unified cross-account message digest.
 *
 * Renders one section per message category (Personal / Transactional /
 * Newsletter / Marketing / Social / Automated) from the GET /threads endpoint.
 * Starred mail is not a section — Flagged is a virtual mailbox in the nav. The
 * brief defaults to the cross-account aggregate; the kit `BriefSections` owns
 * the filter row (categories + attribute chips + the account source group) and
 * the flatten-when-filtered behavior, while `MailListHeader` provides the title,
 * unread count, and search. Account switching also lives in the nav sidebar —
 * the account source group only appears when more than one account feeds the
 * brief.
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
	type BriefCategoryFilter,
	BriefSections,
	briefFilterConfig,
	ComfortableRowTextContent,
	cn,
	comfortableRowClass,
	type FilterSheetProps,
	type FilterSheetSource,
	KeyboardHintBar,
	type SearchResult,
	type ThreadRowData,
	type ThreadSection,
} from "@remit/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useSearchTokenContext } from "@/hooks/useSearchTokenContext";
import { useSemanticSearch } from "@/hooks/useSemanticSearch";
import { sortAccountsByCreatedAt } from "@/lib/account-order";
import {
	groupBriefSections,
	matchesBriefSearch,
	matchesSearchTokens,
	toThreadRowData,
} from "@/lib/brief";
import { isServerError } from "@/lib/error-classifier";
import { useMailContext } from "@/lib/mail-context";
import { relatedSearchResults, rowToSearchResult } from "@/lib/search-result";
import { parseSearchTokens } from "@/lib/search-tokens";
import { MailListHeader } from "./MailListHeader";

/* The brief's attribute chips as predicates (mirrors the kit `briefFilterChips`
   ids) so the phone search takeover narrows results the same way the list does. */
const BRIEF_SEARCH_PREDICATES: Record<string, (t: ThreadRowData) => boolean> = {
	unread: (t) => !t.isRead,
	attachment: (t) => t.hasAttachment === true,
	contacts: (t) => t.trust === "vip" || t.trust === "wellknown",
	today: (t) =>
		t.sentDate != null &&
		new Date(t.sentDate).toDateString() === new Date().toDateString(),
};

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
	/** Opens an in-list brief row (resolved by messageId against the loaded list). */
	onSelectMessage?: (id: string) => void;
	/**
	 * Opens a search result. A semantic "Related" hit carries its thread + mailbox
	 * so it opens even when its message isn't in the loaded brief list.
	 */
	onSelectSearchResult?: (result: SearchResult) => void;
}

export function DailyBrief({
	accounts,
	selectedMessageId,
	onSelectMessage,
	onSelectSearchResult,
}: DailyBriefProps) {
	const { searchQuery } = useMailContext();
	const tokenContext = useSearchTokenContext();
	const isDesktop = useIsDesktop();

	const nonMuted = useMemo(
		() => sortAccountsByCreatedAt(accounts.filter((a) => !a.muted?.value)),
		[accounts],
	);

	// "all" = the cross-account aggregate (the brief's default). Account
	// switching also lives in the nav sidebar; this source group is a convenience
	// shown only when more than one account feeds the brief. The category axis and
	// attribute chips are owned by the kit `BriefSections` filter row; the brief
	// only controls the category (so it can drive the flatten-when-filtered path)
	// and the account source.
	const [selectedAccountId, setSelectedAccountId] = useState("all");
	const [selectedCategory, setSelectedCategory] =
		useState<BriefCategoryFilter>("all");

	// Attribute chips for the phone search takeover. The brief list's own chips
	// live inside the kit `BriefSections`; the takeover is a separate surface, so
	// it carries its own additive set (category + account are shared above).
	const [searchAttributes, setSearchAttributes] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [searchExpanded, setSearchExpanded] = useState(false);
	const toggleSearchAttribute = useCallback((id: string) => {
		setSearchAttributes((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
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
			// A 4xx here is the account's own problem (IMAP down, auth expired) and
			// renders the inline "Reconnect" banner below — opt it out of the global
			// fatal overlay. A 5xx is OUR API breaking, not the account, and still
			// escalates globally (meta.softError is ignored for 5xx — #1059).
			meta: { softError: true },
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
			return !isServerError(query.error);
		});
	}, [nonMuted, mailboxQueries]);

	const { freeText: sq, tokens: queryTokens } = parseSearchTokens(
		searchQuery.trim().toLowerCase(),
		tokenContext,
	);

	// Convert API rows to ThreadRowData, narrowing only by the selected account
	// and the free-text search plus any filter tokens (`from:`, `has:attachment`,
	// `is:unread`, `before:`/`after:`, `in:`, `account:`) parsed out of the
	// query. The category axis and the attribute chips are the kit
	// `BriefSections` filter row's job, so the full per-category sections are
	// handed to it; it groups, narrows, and flattens.
	const filteredRows = useMemo<ThreadRowData[]>(() => {
		const raw = threadsData?.items ?? [];
		return raw
			.filter(
				(t) =>
					selectedAccountId === "all" ||
					(t.accountId ?? t.accountConfigId) === selectedAccountId,
			)
			.map(toThreadRowData)
			.filter(
				(t) =>
					(!sq || matchesBriefSearch(t, sq)) &&
					matchesSearchTokens(t, queryTokens),
			);
	}, [threadsData, selectedAccountId, sq, queryTokens]);

	const sections = useMemo<ThreadSection[]>(
		() => groupBriefSections(filteredRows),
		[filteredRows],
	);

	const accountSources = useMemo<FilterSheetSource[]>(() => {
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

	const mutedCount = useMemo(
		() => accounts.filter((a) => a.muted?.value).length,
		[accounts],
	);

	const totalUnseen = useMemo(
		() => Array.from(unseenByAccount.values()).reduce((a, b) => a + b, 0),
		[unseenByAccount],
	);

	// The phone search takeover renders the account/free-text-narrowed rows,
	// further narrowed by the shared category and the takeover's attribute chips.
	const searchResults = useMemo<SearchResult[]>(() => {
		const predicates = Array.from(searchAttributes)
			.map((id) => BRIEF_SEARCH_PREDICATES[id])
			.filter((p): p is (t: ThreadRowData) => boolean => p != null);
		return filteredRows
			.filter(
				(t) =>
					(selectedCategory === "all" || t.category === selectedCategory) &&
					predicates.every((p) => p(t)),
			)
			.map(rowToSearchResult);
	}, [filteredRows, selectedCategory, searchAttributes]);

	// "Related" (semantic) spans every account here — the brief is the
	// cross-account view, so no mailbox scope. Dedupe against the literal "Top
	// matches" by thread; the brief rows key on messageId, so resolve each back to
	// its thread via the raw threads.
	const { hits: semanticHits, isLoading: relatedLoading } = useSemanticSearch();
	const relatedResults = useMemo<SearchResult[]>(() => {
		const threadByMessageId = new Map<string, string>();
		for (const thread of threadsData?.items ?? []) {
			threadByMessageId.set(thread.messageId, thread.threadId);
		}
		const literalThreadIds = searchResults
			.map((result) => threadByMessageId.get(result.id))
			.filter((id): id is string => id != null);
		return relatedSearchResults(semanticHits, literalThreadIds);
	}, [semanticHits, searchResults, threadsData]);

	const searchFilterConfig = useMemo<Omit<FilterSheetProps, "children">>(() => {
		const preset = briefFilterConfig(
			accountSources.map((s) => ({
				id: s.id,
				label: s.label,
				count: s.count,
				active: s.active,
			})),
		);
		return {
			categories: preset.categories,
			filters: preset.filters,
			sources: preset.sources,
			sourcesNote: mutedCount > 0 ? `+${mutedCount} muted` : undefined,
			selectedCategory,
			activeFilters: searchAttributes,
			expanded: searchExpanded,
			onExpandedChange: setSearchExpanded,
			onSelectCategory: (id: string) =>
				setSelectedCategory(id as BriefCategoryFilter),
			onSelectSource: setSelectedAccountId,
			onToggleFilter: toggleSearchAttribute,
			onClear: () => {
				setSelectedCategory("all");
				setSelectedAccountId("all");
				setSearchAttributes(new Set());
			},
		};
	}, [
		accountSources,
		mutedCount,
		selectedCategory,
		searchAttributes,
		searchExpanded,
		toggleSearchAttribute,
	]);

	// The brief is genuinely empty (caught up) only when nothing is narrowing the
	// view: no account source and no search. When a source/search yields nothing,
	// the BriefSections filter row stays so the user can clear it.
	const caughtUp =
		sections.length === 0 && selectedAccountId === "all" && sq.length === 0;

	const stateBody = isLoading ? (
		<div className="h-full overflow-y-auto">
			<SectionSkeleton />
			<SectionSkeleton />
		</div>
	) : isError ? (
		<div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-sm text-fg-muted">
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
	) : caughtUp ? (
		<div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center px-4">
			<Sparkles className="size-8 text-fg-subtle" />
			<p className="text-sm font-medium text-fg">You're caught up</p>
			<p className="text-xs text-fg-subtle">Nothing needs attention.</p>
		</div>
	) : (
		<BriefSections
			sections={sections}
			Row={BriefRow}
			briefCategory={selectedCategory}
			onSelectBriefCategory={setSelectedCategory}
			sources={accountSources}
			sourcesNote={mutedCount > 0 ? `+${mutedCount} muted` : undefined}
			onSelectSource={setSelectedAccountId}
			selectedThreadId={selectedMessageId}
			onSelectThread={onSelectMessage}
		/>
	);

	return (
		<MailListHeader
			title="Daily brief"
			unreadCount={totalUnseen}
			footer={isDesktop ? <KeyboardHintBar /> : undefined}
			searchFilter={searchFilterConfig}
			searchResults={searchResults}
			searchLoading={isLoading}
			relatedResults={relatedResults}
			relatedLoading={relatedLoading}
			onSelectSearchResult={onSelectSearchResult}
		>
			<div className="flex h-full flex-col">
				{failedAccounts.map((account) => (
					<ErrorBanner
						key={account.accountId}
						accountEmail={account.email}
						accountId={account.accountId}
					/>
				))}
				<div className="min-h-0 flex-1">{stateBody}</div>
			</div>
		</MailListHeader>
	);
}
