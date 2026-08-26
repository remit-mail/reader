/**
 * DailyBrief — unified cross-account message digest.
 *
 * Renders one section per message category (Personal / Transactional /
 * Newsletter / Marketing / Social / Automated) from the GET /threads endpoint.
 * Starred mail is not a section — Flagged is a virtual mailbox in the nav. The
 * brief defaults to the cross-account aggregate, and `MailListHeader` provides
 * the title, unread count, and search.
 *
 * The list's filter surface is the kit `BriefSections`: categories, attribute
 * chips and the account source group, in a panel the list header's caret opens
 * over the rows. `FilterPanelProvider` shares that panel's open state between
 * the caret and the sheet, the same shape `MailViewChrome` gives the mailbox and
 * Starred views. The category and the chips narrow the grouped sections
 * themselves, and the phone search takeover reads the same selection, so a
 * filter set on one surface holds on the other. Under a query the chips are
 * terms of that query — see `briefChipFilters` — so what narrows the list is
 * readable and editable in the search field.
 *
 * Multi-select is the mailbox list's, not a copy of it: the same
 * `ThreadListInteraction` cursor and `useSelection` state, and the same
 * `SelectionTopBar` in place of the pane header. A shift-range spans the rendered rows in
 * document order, so it crosses category sections exactly as the eye reads
 * them and never picks up a row hidden behind "Show N more" or a collapsed
 * header. Folder-scoped verbs (Move, Apply label, Organize) resolve their
 * account and source folder from the selection — see
 * `resolveBriefSelectionScope`.
 *
 * Loading: skeleton rows on first paint, patch-in-place on refetch.
 * Error: per-section; the brief still renders other sections.
 * Empty: "You're caught up", but only once the server confirms no sync is
 * running — while one is, the same empty list says it is still syncing.
 */
import {
	mailboxOperationsListMailboxesOptions,
	unifiedThreadOperationsListAllThreadsOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import {
	type BriefCategoryFilter,
	BriefEmpty,
	type BriefFilterId,
	BriefSections,
	briefChipCategory,
	briefChipFilters,
	briefFilterConfig,
	briefFilterHasTerm,
	clearBriefFiltersInQuery,
	FilterPanelProvider,
	type FilterSheetProps,
	type FilterSheetSource,
	KeyboardHintBar,
	matchesBriefFilters,
	partitionSpamResults,
	RefreshButton,
	type SearchResult,
	type SelectionRestriction,
	SelectionTopBar,
	SpamResultsOffer,
	setBriefCategoryInQuery,
	type ThreadRowData,
	type ThreadSection,
	toggleBriefFilterInQuery,
} from "@remit/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertCircle, RefreshCw } from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useMemo,
	useState,
} from "react";
import { useJunkMailbox } from "@/hooks/useArchiveMailbox";
import {
	isSyncingPhase,
	useInitialSyncProgress,
} from "@/hooks/useInitialSyncProgress";
import { useLabelList } from "@/hooks/useLabels";
import { useLayoutTier } from "@/hooks/useLayoutTier";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useRefreshControl } from "@/hooks/useRefreshControl";
import { useSearchTokenContext } from "@/hooks/useSearchTokenContext";
import { useSemanticSearch } from "@/hooks/useSemanticSearch";
import type { TriageContextUpdate } from "@/hooks/useTriageLayer";
import { sortAccountsByCreatedAt } from "@/lib/account-order";
import {
	excludeMutedSenders,
	groupBriefSections,
	matchesBriefSearch,
	matchesSearchTokens,
	mergeSearchRows,
	toThreadRowData,
} from "@/lib/brief";
import { isServerError } from "@/lib/error-classifier";
import { junkDestination } from "@/lib/junk-destination";
import type { ListHeaderChrome } from "@/lib/list-header-chrome";
import { useMailContext } from "@/lib/mail-context";
import { useMailFreshness } from "@/lib/mail-freshness";
import { relatedSearchResults, rowToSearchResult } from "@/lib/search-result";
import { showInlineSearchResults } from "@/lib/search-surface";
import { parseSearchTokens } from "@/lib/search-tokens";
import { resolveSelectionAccountScope } from "@/lib/selection-account-scope";
import { spamOfferForResults } from "@/lib/spam-offer";
import { wizardSelectionFrom } from "@/lib/wizard-selection";
import {
	type OpenThreadTarget,
	type SelectionWizardControl,
	useGoToSection,
	useScopeSearchToMailbox,
	useSelectionWizard,
} from "@/routing";
import { LabelApplyTrigger } from "./LabelApplyTrigger";
import { MailListHeader, type MailListHeaderProps } from "./MailListHeader";
import type { MessageListCommands } from "./MessageList";
import { MessageRow } from "./MessageRow";
import { SelectionWizardHost } from "./SelectionWizardHost";
import {
	type OpenMessageOptions,
	ThreadListInteraction,
	useThreadListSelection,
} from "./ThreadListInteraction";

/* Page size for the unscoped cross-folder search. One page is what the takeover
   and the "Top matches" list render; the server caps it at 500. */
const UNSCOPED_SEARCH_PAGE_SIZE = 200;

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
	const goToSection = useGoToSection();
	return (
		<div className="flex items-center gap-2 px-row-inset py-2 border-b border-line bg-danger-soft/40 text-xs text-danger">
			<AlertCircle className="size-3.5 shrink-0" />
			<span className="flex-1 truncate">{accountEmail} can't connect</span>
			<button
				type="button"
				onClick={() => goToSection("accounts")}
				className="shrink-0 underline text-danger hover:opacity-80"
			>
				Reconnect
			</button>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Selection surface (the mailbox list's, mounted on the brief)
// ---------------------------------------------------------------------------

export interface BriefSelectionScope {
	/** Owning account, when every selected row shares one. */
	accountId?: string;
	/** Source folder, when every selected row shares one. */
	mailboxId?: string;
	/** Which scope the selection spans more of than those verbs can take. */
	restriction?: SelectionRestriction;
	/** Why folder-scoped verbs are withheld, in the toolbar's own words. */
	moveDisabledHint?: string;
}

/**
 * The account and source folder a brief selection resolves to.
 *
 * The mailbox list gets these from the route and scopes Move, Apply label and
 * Organize to them. The brief spans accounts and folders, so it resolves them
 * from the selection itself and withholds those verbs — with the reason on
 * screen — whenever the selection spans more than one. Delete and mark-read
 * carry no such scope and are always offered.
 *
 * Pure so the guard is unit-testable without a DOM.
 */
export const resolveBriefSelectionScope = (
	rows: readonly ThreadRowData[],
	selectedIds: ReadonlySet<string>,
): BriefSelectionScope => {
	if (selectedIds.size === 0) return {};
	const selected = rows.filter((row) => selectedIds.has(row.id));
	const account = resolveSelectionAccountScope(
		selected.map((row) => row.accountId),
	);
	if (account.restriction) return account;
	const mailboxIds = new Set<string>();
	for (const row of selected) {
		if (row.mailboxId) mailboxIds.add(row.mailboxId);
	}
	if (mailboxIds.size > 1) {
		return {
			accountId: account.accountId,
			restriction: "spansFolders",
			moveDisabledHint: `Move only works within one folder — this selection spans ${mailboxIds.size} folders`,
		};
	}
	return {
		accountId: account.accountId,
		mailboxId: mailboxIds.size === 1 ? [...mailboxIds][0] : undefined,
	};
};

interface BriefSelectionChromeProps {
	/** Everything the header needs when no selection is active. */
	header: Omit<
		MailListHeaderProps,
		"children" | "selectionBar" | "paneOverlay"
	>;
	/** The rows the list is showing, for resolving the selection's scope. */
	rows: readonly ThreadRowData[];
	/** The wizard every verb on this bar opens, shared with the keyboard layer. */
	wizard: SelectionWizardControl;
	children: ReactNode;
}

/**
 * The brief's selection chrome: the same surface the mailbox list raises, in
 * the same place. The pane header carries the count and the verbs from the
 * first ticked row. The selection itself comes from the enclosing
 * `ThreadListInteraction`, so the brief and the mailbox list run one model.
 */
function BriefSelectionChrome({
	header,
	rows,
	wizard,
	children,
}: BriefSelectionChromeProps) {
	const {
		selectedIds,
		selectedCount,
		exitSelection,
		orderedIds,
		allSelected,
		toggleAllLoaded,
	} = useThreadListSelection();

	const scope = useMemo(
		() => resolveBriefSelectionScope(rows, selectedIds),
		[rows, selectedIds],
	);
	const { junkMailboxId } = useJunkMailbox(scope.accountId);
	const { labels } = useLabelList(scope.accountId);

	const selectedMessageIds = useMemo(
		() => Array.from(selectedIds),
		[selectedIds],
	);
	// The ticked rows as the wizard reads them — the sample under every screen
	// that names a match, and the senders its widen falls back to.
	const wizardSelection = useMemo(
		() => wizardSelectionFrom(rows, selectedIds),
		[rows, selectedIds],
	);

	const junkDestinationId = junkDestination(junkMailboxId, scope.mailboxId);

	// One select-all for both surfaces: the desktop toolbar and the touch sheet
	// offer the same control over the same rendered rows, so the verb a phone
	// can reach is the verb a desktop can reach.
	const selectAll = useMemo(
		() =>
			orderedIds.length > 0
				? {
						checked: allSelected,
						indeterminate: selectedCount > 0 && !allSelected,
						onChange: toggleAllLoaded,
					}
				: undefined,
		[orderedIds.length, allSelected, selectedCount, toggleAllLoaded],
	);

	// The bar shows one notice at a time, so the scope restriction rides in as
	// a notice — the same fold-in the mailbox list does.
	const notice = scope.moveDisabledHint
		? { tone: "warning" as const, text: scope.moveDisabledHint }
		: undefined;

	const selectionBar = (chrome: ListHeaderChrome) => (
		<SelectionTopBar
			title={chrome.title}
			navSlot={chrome.navSlot}
			titleMeta={chrome.titleMeta}
			searchSlot={chrome.searchSlot}
			searchField={chrome.searchField}
			idleSlot={chrome.makeFilterSlot}
			count={selectedCount}
			onCancel={exitSelection}
			onDelete={() => wizard.start("delete")}
			onMove={() => wizard.start("move")}
			onOrganize={() => wizard.start("organize")}
			onJunk={junkDestinationId ? () => wizard.start("junk") : undefined}
			onMarkRead={() => wizard.start("markRead")}
			overflowSlot={
				scope.accountId &&
				scope.mailboxId &&
				selectedCount > 0 &&
				labels.length > 0 ? (
					<LabelApplyTrigger
						accountId={scope.accountId}
						mailboxId={scope.mailboxId}
						messageIds={selectedMessageIds}
					/>
				) : undefined
			}
			selectAll={selectAll}
			notice={notice}
		/>
	);

	// Mounted as the pane's overlay rather than beside the header: the brief hands
	// its body over to the search results panel while a query is being typed, and
	// the wizard is not part of the body it hands over. The overlay slot also puts
	// it inside the list header's chrome, which is where the converted query it
	// opens on comes from.
	return (
		<MailListHeader
			{...header}
			selectionBar={selectionBar}
			paneOverlay={
				<SelectionWizardHost
					verb={wizard.verb}
					accountId={scope.accountId}
					mailboxId={scope.mailboxId}
					selection={wizardSelection}
					selectionRestriction={scope.restriction}
					onFinished={exitSelection}
				/>
			}
		>
			{children}
		</MailListHeader>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DailyBriefProps {
	accounts: RemitImapAccountResponse[];
	selectedMessageId?: string;
	/**
	 * Opens a row. Every row the brief renders names its thread, so the row the
	 * search widened in from another folder opens by exactly the same route as one
	 * from the unified inbox.
	 */
	onOpenThread?: (
		target: OpenThreadTarget,
		options?: OpenMessageOptions,
	) => void;
	/** Where the list publishes the commands the keyboard layer drives. */
	commandsRef?: RefObject<MessageListCommands | null>;
	/** Cursor / selection / display order, reported up to the triage layer. */
	onTriageContextChange?: (context: TriageContextUpdate) => void;
	onDeleteMessages: (messageIds: string[]) => void;
}

export function DailyBrief({
	accounts,
	selectedMessageId,
	onOpenThread,
	commandsRef,
	onTriageContextChange,
	onDeleteMessages,
}: DailyBriefProps) {
	const { searchQuery, searchInput, resultFolderIndex, onSearchChange } =
		useMailContext();
	const tokenContext = useSearchTokenContext();
	const isDesktop = useIsDesktop();
	const tier = useLayoutTier();
	const wizard = useSelectionWizard();
	const scopeSearchToMailbox = useScopeSearchToMailbox();

	const nonMuted = useMemo(
		() => sortAccountsByCreatedAt(accounts.filter((a) => !a.muted?.value)),
		[accounts],
	);

	// "all" = the cross-account aggregate (the brief's default), and "all"
	// categories = the full set of sections. Account switching also lives in the
	// nav sidebar; the category also drives the flatten-when-filtered path.
	const [selectedAccountId, setSelectedAccountId] = useState("all");
	const [selectedCategory, setSelectedCategory] =
		useState<BriefCategoryFilter>("all");

	// Held here rather than inside the list's filter sheet: the phone search
	// takeover narrows the same rows by the same chips, and the body is unmounted
	// and remounted around a query being typed, which would take a set living
	// below with it.
	const [activeFilters, setActiveFilters] = useState<
		ReadonlySet<BriefFilterId>
	>(new Set());
	const [filterExpanded, setFilterExpanded] = useState(false);
	const toggleFilter = useCallback((id: BriefFilterId) => {
		setActiveFilters((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);
	const clearFilters = useCallback(() => setActiveFilters(new Set()), []);

	const searching = searchInput.trim().length > 0;

	// Under a query the chips and the query are one state: a chip writes its term
	// into the query — `is:unread`, `has:attachment`, `category:newsletter` — and
	// a term typed by hand ticks its chip. What narrows the rows is then legible
	// in the field, editable there, and gone when the term is deleted. The
	// panel's own set survives a search and comes back with it, and carries the
	// two chips the vocabulary cannot spell (see `briefChipFilters`).
	const chipFilters = useMemo(
		() => briefChipFilters({ query: searchInput, ownFilters: activeFilters }),
		[searchInput, activeFilters],
	);
	const chipCategory = useMemo(
		() =>
			briefChipCategory({ query: searchInput, ownCategory: selectedCategory }),
		[searchInput, selectedCategory],
	);

	const toggleChip = useCallback(
		(id: BriefFilterId) => {
			if (!searching || !briefFilterHasTerm(id)) {
				toggleFilter(id);
				return;
			}
			const next = toggleBriefFilterInQuery(searchInput, id);
			if (next !== undefined) onSearchChange(next);
		},
		[searching, searchInput, onSearchChange, toggleFilter],
	);

	const selectChipCategory = useCallback(
		(category: BriefCategoryFilter) => {
			if (!searching) {
				setSelectedCategory(category);
				return;
			}
			onSearchChange(setBriefCategoryInQuery(searchInput, category));
		},
		[searching, searchInput, onSearchChange],
	);

	const clearChips = useCallback(() => {
		setSelectedCategory("all");
		setSelectedAccountId("all");
		clearFilters();
		if (searching) onSearchChange(clearBriefFiltersInQuery(searchInput));
	}, [searching, searchInput, onSearchChange, clearFilters]);

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

	// --- Unscoped search query ---
	// The brief's list is the unified INBOX, so filtering it client-side can only
	// ever find inbox mail. The same endpoint in search mode (`query`) widens to
	// every non-muted folder of every account — Archive, Sent, Spam, custom
	// folders — and matches subject/From in the query. Its rows are merged with
	// the client-side pass below, which still contributes snippet matches the
	// server does not index.
	const { data: searchData, isFetching: searchFetching } = useQuery({
		...unifiedThreadOperationsListAllThreadsOptions({
			query: { query: sq, limit: UNSCOPED_SEARCH_PAGE_SIZE },
		}),
		enabled: sq.length > 0,
		staleTime: 30_000,
	});

	// Convert API rows to ThreadRowData, narrowing only by the selected account
	// and the free-text search plus any filter tokens (`from:`, `has:attachment`,
	// `is:unread`, `before:`/`after:`, `in:`, `account:`) parsed out of the
	// query. The category axis is applied further down, on the grouped sections,
	// so the list body can flatten them when narrowed to one category.
	const filteredRows = useMemo<ThreadRowData[]>(() => {
		const briefRows = excludeMutedSenders(threadsData?.items ?? []).map(
			toThreadRowData,
		);
		// No free text: the brief list as it comes, order untouched.
		const rows = sq
			? mergeSearchRows(
					briefRows.filter((t) => matchesBriefSearch(t, sq)),
					excludeMutedSenders(searchData?.items ?? []).map(toThreadRowData),
				)
			: briefRows;
		return rows.filter(
			(t) =>
				(selectedAccountId === "all" || t.accountId === selectedAccountId) &&
				matchesSearchTokens(t, queryTokens),
		);
	}, [threadsData, searchData, selectedAccountId, sq, queryTokens]);

	// The unscoped search reaches every folder, Spam included (see `filteredRows`
	// above), and the brief is the one global-scope view whose own rows now stand
	// in for the read-only results panel once the query commits. The panel held
	// Spam out and offered a way to it instead (`MailListHeader`'s `spamOffer`);
	// the brief's own body has to do the same, or a committed search surfaces
	// junk mail inline and drops the way back to it. A bare token query (e.g.
	// `is:unread`) never reaches the widened endpoint, so there is nothing to
	// hold out.
	const { bodyRows, briefSpamOffer } = useMemo(() => {
		if (!sq) return { bodyRows: filteredRows, briefSpamOffer: undefined };
		const asResults = filteredRows.map((row) =>
			rowToSearchResult(row, resultFolderIndex),
		);
		const { spam } = partitionSpamResults(asResults);
		if (spam.length === 0) {
			return { bodyRows: filteredRows, briefSpamOffer: undefined };
		}
		const spamIds = new Set(spam.map((result) => result.id));
		return {
			bodyRows: filteredRows.filter((row) => !spamIds.has(row.id)),
			briefSpamOffer: spamOfferForResults(asResults),
		};
	}, [filteredRows, sq, resultFolderIndex]);

	const sections = useMemo<ThreadSection[]>(
		() => groupBriefSections(bodyRows),
		[bodyRows],
	);

	// A committed query puts rows the widened cross-folder search found into the
	// body, and those messages are in folders the brief itself never loads. They
	// open like any other row: what the address carries is the thread, which
	// every row names, and the conversation is fetched by it (#635).
	const openRow = useCallback(
		(id: string, options?: OpenMessageOptions) => {
			const threadId = filteredRows.find((row) => row.id === id)?.threadId;
			if (!threadId) return;
			onOpenThread?.({ threadId, messageId: id }, options);
		},
		[filteredRows, onOpenThread],
	);

	// The two-engine results panel, whose semantic hits are in no list at all —
	// each one carries the thread it belongs to.
	const openResult = useCallback(
		(result: SearchResult) => {
			const threadId =
				result.threadId ??
				filteredRows.find((row) => row.id === result.id)?.threadId;
			if (!threadId) return;
			onOpenThread?.({ threadId, messageId: result.id });
		},
		[filteredRows, onOpenThread],
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

	// Every non-muted account the brief aggregates — refreshing it means
	// refreshing all of them, same as the accounts the "caught up" reading
	// above already spans.
	const refreshAccountIds = useMemo(
		() => nonMuted.map((account) => account.accountId),
		[nonMuted],
	);
	const { hasNewMail } = useMailFreshness();
	const {
		state: refreshState,
		errorMessage: refreshError,
		refresh: onRefreshBrief,
	} = useRefreshControl(refreshAccountIds, { onSettled: () => refetch() });
	// Memoized: this element is a dep of `MailListHeader`'s own `chrome` memo
	// (via the `refreshControl` prop), so a fresh element identity every render
	// would defeat that memo and re-render every chrome consumer with it.
	const refreshControl = useMemo(
		() => (
			<RefreshButton
				state={refreshState}
				onRefresh={onRefreshBrief}
				label="Refresh daily brief"
				errorMessage={refreshError}
				hasUpdate={hasNewMail(refreshAccountIds)}
			/>
		),
		[refreshState, onRefreshBrief, refreshError, hasNewMail, refreshAccountIds],
	);

	// The phone search takeover renders the account/free-text-narrowed rows,
	// further narrowed by the same category and attribute chips the list applies.
	const searchResults = useMemo<SearchResult[]>(
		() =>
			filteredRows
				.filter(
					(t) =>
						(chipCategory === "all" || t.category === chipCategory) &&
						matchesBriefFilters(t, chipFilters),
				)
				.map((row) => rowToSearchResult(row, resultFolderIndex)),
		[filteredRows, chipCategory, chipFilters, resultFolderIndex],
	);

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
		return relatedSearchResults(
			semanticHits,
			literalThreadIds,
			resultFolderIndex,
		);
	}, [semanticHits, searchResults, threadsData, resultFolderIndex]);

	const filterConfig = useMemo<Omit<FilterSheetProps, "children">>(() => {
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
			selectedCategory: chipCategory,
			activeFilters: chipFilters,
			expanded: filterExpanded,
			onExpandedChange: setFilterExpanded,
			onSelectCategory: (id: string) =>
				selectChipCategory(id as BriefCategoryFilter),
			onSelectSource: setSelectedAccountId,
			onToggleFilter: (id: string) => toggleChip(id as BriefFilterId),
			onClear: clearChips,
		};
	}, [
		accountSources,
		mutedCount,
		chipCategory,
		chipFilters,
		filterExpanded,
		toggleChip,
		selectChipCategory,
		clearChips,
	]);

	// The brief is genuinely empty (caught up) only when nothing is narrowing the
	// view: no account source and no search — free text or token. When a
	// source/search yields nothing, the list says so instead, so the narrowing
	// is still visible as the reason.
	const caughtUp =
		sections.length === 0 &&
		selectedAccountId === "all" &&
		sq.length === 0 &&
		queryTokens.length === 0;

	// "Caught up" is a claim about the user's mail, so it may only be made once
	// the server has confirmed no sync is running (#452). The config snapshot
	// that carries these accounts is fetched once (staleTime Infinity), so its
	// syncPhase is a seed rather than a reading: it says a sync WAS running when
	// the accounts loaded, which is enough to start the live poll before the list
	// paints — the post-onboarding case that produced the false claim.
	const briefAccountIds = useMemo(
		() => nonMuted.map((a) => a.accountId),
		[nonMuted],
	);
	const seededSyncing = useMemo(
		() => nonMuted.some((a) => isSyncingPhase(a.syncPhase)),
		[nonMuted],
	);
	const syncProgress = useInitialSyncProgress(
		briefAccountIds,
		caughtUp || seededSyncing,
	);

	const briefSkeleton = (
		<div className="h-full overflow-y-auto">
			<SectionSkeleton />
			<SectionSkeleton />
		</div>
	);

	// The filter sheet lives in the list body, so it is on screen only when the
	// rows are. The caret reads the same answer and stands down everywhere else,
	// rather than opening nothing over a skeleton or an empty state.
	const showsRows = !isLoading && !isError && !caughtUp;

	// A search does not take the panel down — the chips compose into the query
	// rather than competing with it. The one window where the brief's own body is
	// not on screen is the two-engine results panel, which owns the pane while a
	// first query is still being typed; the caret stands down for exactly that,
	// on the same answer the header swaps the body on.
	const resultsPanelOwnsBody = showInlineSearchResults({
		tier,
		hasLiveInput: searching,
		hasCommittedQuery: searchQuery.trim().length > 0,
		bodyRendersCommittedResults: true,
	});

	const stateBody = showsRows ? (
		<div className="flex h-full min-h-0 flex-col">
			{briefSpamOffer && (
				<SpamResultsOffer
					count={briefSpamOffer.count}
					onScopeToSpam={() =>
						scopeSearchToMailbox(briefSpamOffer.mailboxId, searchQuery)
					}
				/>
			)}
			<div className="min-h-0 flex-1">
				<BriefSections
					sections={sections}
					briefCategory={chipCategory}
					Row={MessageRow}
					selectedThreadId={selectedMessageId}
					onSelectThread={openRow}
					onSelectBriefCategory={selectChipCategory}
					sources={accountSources}
					sourcesNote={mutedCount > 0 ? `+${mutedCount} muted` : undefined}
					onSelectSource={setSelectedAccountId}
					activeFilters={chipFilters}
					onToggleFilter={toggleChip}
					onClearFilters={clearChips}
				/>
			</div>
		</div>
	) : isLoading ? (
		briefSkeleton
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
	) : syncProgress.resolved ? (
		<BriefEmpty
			sync={
				syncProgress.syncing
					? { synced: syncProgress.synced, total: syncProgress.total }
					: undefined
			}
		/>
	) : (
		briefSkeleton
	);

	// The cursor and selection wrap the whole pane, not just the list body: the
	// selection toolbar takes the header's place while rows are selected, so it
	// has to sit inside the same provider the rows do. The filter panel spans the
	// same pane for the same reason — the caret is in the header, the panel is
	// above the rows.
	return (
		<FilterPanelProvider hasSheet={showsRows && !resultsPanelOwnsBody}>
			<ThreadListInteraction
				selectedMessageId={selectedMessageId}
				rows={filteredRows}
				onOpen={openRow}
				onDeleteMessages={onDeleteMessages}
				onSelectionVerb={wizard.start}
				commandsRef={commandsRef}
				onTriageContextChange={onTriageContextChange}
			>
				<BriefSelectionChrome
					wizard={wizard}
					header={{
						title: "Daily brief",
						unreadCount: totalUnseen,
						footer: isDesktop ? <KeyboardHintBar /> : undefined,
						searchFilter: filterConfig,
						searchResults,
						searchLoading: isLoading || searchFetching,
						relatedResults,
						relatedLoading,
						onSelectSearchResult: openResult,
						// The body already narrows to the committed query
						// (`matchesBriefSearch` + `matchesSearchTokens` + the server `query`,
						// above), so a committed search is a selectable list here exactly as
						// it is on the mailbox route (#212) — the two-engine panel stays for
						// the typing/uncommitted state only.
						searchResultsInBody: true,
						refreshControl,
					}}
					rows={filteredRows}
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
				</BriefSelectionChrome>
			</ThreadListInteraction>
		</FilterPanelProvider>
	);
}
