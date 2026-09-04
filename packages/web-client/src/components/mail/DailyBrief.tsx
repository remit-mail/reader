/**
 * DailyBrief — unified cross-account message digest.
 *
 * Renders one section per message category (Personal / Transactional /
 * Newsletter / Marketing / Social / Automated / Unclassified) from the GET
 * /threads endpoint. Starred mail is not a section — Flagged is a virtual
 * mailbox in the nav. The brief defaults to the cross-account aggregate, and
 * `MailListHeader` provides the title, unread count, and search.
 *
 * The brief paginates by section, not as a whole. Each section is its own
 * category-scoped request for its newest rows plus one count of the whole
 * category, so a header states how much mail that category holds rather than how
 * many of a shared 50-row window fell into it, and a category whose mail is all
 * older than that window still has a section with rows in it (#312). "Show all"
 * hands the reader to the brief's own filtered list for that category; nothing
 * here loads a mailbox.
 *
 * Sections are the unsearched brief only. A search is one request and one flat
 * list, newest first across every category: sectioning the matches would order
 * them by category first and recency second, putting last spring's newsletter
 * above a mail that arrived this morning.
 *
 * The list's filter surface is the kit `BriefSections`: categories, attribute
 * chips and the account source group, in a panel the list header's caret opens
 * over the rows. `FilterPanelProvider` shares that panel's open state between
 * the caret and the sheet, the same shape `MailViewChrome` gives the mailbox and
 * Starred views. The list draws those controls but applies none of them: the
 * category and every chip a parameter can express travel with the section
 * requests, and the two that cannot ("From contacts", "Today") are applied here
 * alongside the residual tokens (#314). The phone search takeover reads the same
 * selection and the same rows, so a filter set on one surface holds on the
 * other. Under a query the chips are terms of that query — see
 * `briefChipFilters` — so what narrows the list is readable and editable in the
 * search field.
 *
 * Multi-select is the mailbox list's, not a copy of it: the same
 * `ThreadListInteraction` cursor and `useSelection` state, and the same
 * `SelectionTopBar` in place of the pane header. A shift-range spans the rendered rows in
 * document order, so it crosses category sections exactly as the eye reads
 * them and never picks up a row behind a collapsed header or one the section's
 * page did not reach. Folder-scoped verbs (Move, Apply label, Organize) resolve their
 * account and source folder from the selection — see
 * `resolveBriefSelectionScope`.
 *
 * Loading: skeleton rows on first paint, per-section from then on, and the rows
 * already on screen stay put while the same predicate is re-fetched.
 * Error: a section whose own request never got an answer says so in its own
 * place and the rest of the brief stands. A 5xx is not that case — the API
 * breaking escalates globally (`shouldEscalate`, #1059), and nothing here softens
 * it.
 * Empty: "You're caught up", but only once the server confirms no sync is
 * running — while one is, the same empty list says it is still syncing.
 */
import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapMessageCategory,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
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
	isBriefCategory,
	KeyboardHintBar,
	matchesBriefFilters,
	partitionSpamResults,
	RefreshButton,
	SECTION_ROW_CAP,
	type SearchResult,
	type SelectionRestriction,
	SelectionTopBar,
	SpamResultsOffer,
	setBriefCategoryInQuery,
	type ThreadRowData,
	type ThreadSection,
	toggleBriefFilterInQuery,
} from "@remit/ui";
import { useQueries } from "@tanstack/react-query";
import { AlertCircle, RefreshCw } from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useMemo,
	useState,
} from "react";
import { useJunkMailbox } from "@/hooks/useArchiveMailbox";
import { useBriefSearchRows, useBriefSections } from "@/hooks/useBriefSections";
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
	BRIEF_CATEGORIES,
	type BriefCategoryResult,
	briefSections,
	briefSectionTotal,
	excludeMutedSenders,
	matchesSearchTokens,
	toThreadRowData,
} from "@/lib/brief";
import {
	briefClientOnlyFilters,
	briefCountsMatchRows,
	briefCriteria,
} from "@/lib/brief-criteria";
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
import { dedupeByThread } from "@/lib/starred-rows";
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

/* Rows one category's own list renders once the brief is narrowed to it — the
   "show all" destination, which is a page of that category rather than the whole
   of it. */
const CATEGORY_PAGE_SIZE = 50;

/* One page of matches for a searched brief. The server orders the whole match
   set; this is how much of the front of it the list renders. */
const SEARCH_PAGE_SIZE = 200;

/* The brief asks for no sections while it is answering a search. */
const NO_CATEGORIES: RemitImapMessageCategory[] = [];

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

	// The committed query, split into the free text the request carries and the
	// tokens. Free text is what turns the brief from seven category sections into
	// one ordered list of matches, so it is read before anything downstream of it.
	const { freeText: sq, tokens: queryTokens } = parseSearchTokens(
		searchQuery.trim().toLowerCase(),
		tokenContext,
	);
	const underQuery = sq.length > 0;

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

	// The same two, read off the committed query rather than the field. The chips
	// above tick as the reader types, which is what the panel is for; the requests
	// must not. Half-typed `is:unre` would otherwise fire a fresh burst of section
	// requests on the way to `is:unread`, and the whole point of counting on a
	// deliberate act is that nothing here rides a keystroke.
	const requestFilters = useMemo(
		() => briefChipFilters({ query: searchQuery, ownFilters: activeFilters }),
		[searchQuery, activeFilters],
	);
	const requestCategory = useMemo(
		() =>
			briefChipCategory({ query: searchQuery, ownCategory: selectedCategory }),
		[searchQuery, selectedCategory],
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

	// The way to a section's whole category: the brief's own list, narrowed to
	// that category, which is a request for it rather than more of a window
	// already fetched. Offered only at the "all" scope — inside one category the
	// list already is the destination.
	const showAllSection = useMemo(
		() =>
			requestCategory === "all" && !underQuery
				? (sectionId: string) => {
						if (isBriefCategory(sectionId)) selectChipCategory(sectionId);
					}
				: undefined,
		[requestCategory, underQuery, selectChipCategory],
	);

	const clearChips = useCallback(() => {
		setSelectedCategory("all");
		setSelectedAccountId("all");
		clearFilters();
		if (searching) onSearchChange(clearBriefFiltersInQuery(searchInput));
	}, [searching, searchInput, onSearchChange, clearFilters]);

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

	// --- The brief's rows ---
	// The chips and the tokens as request parameters. The category is not among
	// them: each section is its own category-scoped request, and the category
	// chip decides which sections are on screen rather than narrowing a shared
	// one.
	const { criteria: chipCriteria, residual: residualTokens } = useMemo(
		() => briefCriteria(requestCategory, requestFilters, queryTokens),
		[requestCategory, requestFilters, queryTokens],
	);
	const shownCategories = useMemo<RemitImapMessageCategory[]>(
		() =>
			requestCategory === "all" ? [...BRIEF_CATEGORIES] : [requestCategory],
		[requestCategory],
	);
	// Under a query the category is a parameter again rather than a section
	// scope: there is one request, and the chip narrows it.
	const searchCriteria = useMemo(
		() => ({
			...chipCriteria,
			query: sq,
			...(requestCategory === "all" ? {} : { category: [requestCategory] }),
		}),
		[chipCriteria, sq, requestCategory],
	);
	// The account pills and the tokens no parameter carries narrow the rows after
	// they arrive, so while either is active the count is of a wider set than the
	// list and the sections show no number at all.
	const counted = briefCountsMatchRows({
		residual: residualTokens,
		attributes: requestFilters,
		accountScoped: selectedAccountId !== "all",
	});

	const {
		sections: sectionRows,
		isLoading: sectionsLoading,
		isError: sectionsError,
		refetch: refetchSections,
	} = useBriefSections({
		categories: underQuery ? NO_CATEGORIES : shownCategories,
		criteria: chipCriteria,
		limit: requestCategory === "all" ? SECTION_ROW_CAP : CATEGORY_PAGE_SIZE,
		counted,
	});

	// A search is answered by one request and rendered as one list. Splitting the
	// matches into category sections orders them by category first and recency
	// second, which puts a newsletter from last spring above a mail that arrived
	// this morning — the reading the search is asked to give (#312).
	const {
		rows: searchRows,
		isLoading: searchLoading,
		isError: searchError,
		refetch: refetchSearch,
	} = useBriefSearchRows(searchCriteria, SEARCH_PAGE_SIZE, underQuery);

	const isLoading = underQuery ? searchLoading : sectionsLoading;
	const isError = underQuery ? searchError : sectionsError;
	const refetch = useCallback(() => {
		if (underQuery) {
			refetchSearch();
			return;
		}
		refetchSections();
	}, [underQuery, refetchSearch, refetchSections]);

	// What the request could not carry: muted senders, the account pill, the two
	// chips no endpoint takes a parameter for ("From contacts", "Today"), and the
	// residual tokens (`from:`, `subject:`, `before:`, `after:`, `in:`,
	// `account:`) that `listAllThreads` has no parameter for. Everything else was
	// answered over the whole scope by the request itself, and the order the rows
	// arrived in is kept — narrowing never re-sorts.
	const clientOnlyFilters = useMemo(
		() => briefClientOnlyFilters(requestFilters),
		[requestFilters],
	);
	const narrowRows = useCallback(
		(rows: RemitImapThreadMessageResponse[]): ThreadRowData[] =>
			// One row per conversation, because that is what the server counted:
			// `count` is thread-distinct, and a list keying on messageId puts twelve
			// rows under a header reading one. Collapsed before anything reads a
			// length, so the rows and the number are the same unit.
			dedupeByThread(excludeMutedSenders(rows))
				.map(toThreadRowData)
				.filter(
					(t) =>
						(selectedAccountId === "all" ||
							t.accountId === selectedAccountId) &&
						matchesBriefFilters(t, clientOnlyFilters) &&
						matchesSearchTokens(t, residualTokens),
				),
		[selectedAccountId, clientOnlyFilters, residualTokens],
	);

	const briefRows = useMemo<BriefCategoryResult[]>(
		() =>
			sectionRows.map((section) => ({
				category: section.category,
				total: briefSectionTotal(section.total, section.rows),
				atCap: section.atCap,
				loading: section.loading,
				failed: section.failed,
				rows: narrowRows(section.rows),
			})),
		[sectionRows, narrowRows],
	);

	const matchRows = useMemo<ThreadRowData[]>(
		() => narrowRows(searchRows),
		[searchRows, narrowRows],
	);

	// Each section answers for itself, so a retry is that section's own request.
	const retrySection = useCallback(
		(sectionId: string) => {
			sectionRows.find((section) => section.category === sectionId)?.retry();
		},
		[sectionRows],
	);

	const filteredRows = useMemo<ThreadRowData[]>(
		() =>
			underQuery ? matchRows : briefRows.flatMap((section) => section.rows),
		[underQuery, matchRows, briefRows],
	);

	// A search reaches every folder, Spam included, and the brief is the one
	// global-scope view whose own rows stand in for the read-only results panel
	// once the query commits. The panel held Spam out and offered a way to it
	// instead (`MailListHeader`'s `spamOffer`); the brief's own body has to do the
	// same, or a committed search surfaces junk mail inline and drops the way back
	// to it. A bare token query (e.g. `is:unread`) never reaches search mode, so
	// there is nothing to hold out.
	const { spamIds, briefSpamOffer } = useMemo(() => {
		const none = { spamIds: undefined, briefSpamOffer: undefined };
		if (!sq) return none;
		const asResults = filteredRows.map((row) =>
			rowToSearchResult(row, resultFolderIndex),
		);
		const { spam } = partitionSpamResults(asResults);
		if (spam.length === 0) return none;
		return {
			spamIds: new Set(spam.map((result) => result.id)),
			briefSpamOffer: spamOfferForResults(asResults),
		};
	}, [filteredRows, sq, resultFolderIndex]);

	const sections = useMemo<ThreadSection[]>(() => {
		const keep = (rows: ThreadRowData[]): ThreadRowData[] =>
			spamIds === undefined ? rows : rows.filter((row) => !spamIds.has(row.id));
		// One unlabelled section under a query: the body renders it flat, so the
		// matches stay in the single order the server put them in.
		if (underQuery) return [{ id: "matches", threads: keep(matchRows) }];
		return briefSections(
			briefRows.map((section) => ({
				...section,
				rows: keep(section.rows),
			})),
		);
	}, [underQuery, matchRows, briefRows, spamIds]);

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

	// The phone search takeover renders the rows the list renders: the same
	// requests answered the category and the chips, so a second pass here would
	// narrow one surface by a criterion the other already applied to the whole
	// scope.
	const searchResults = useMemo<SearchResult[]>(
		() => filteredRows.map((row) => rowToSearchResult(row, resultFolderIndex)),
		[filteredRows, resultFolderIndex],
	);

	// "Related" (semantic) spans every account here — the brief is the
	// cross-account view, so no mailbox scope. Dedupe against the literal "Top
	// matches" by thread; the brief rows key on messageId, so resolve each back to
	// its thread via the raw threads.
	const { hits: semanticHits, isLoading: relatedLoading } = useSemanticSearch();
	const relatedResults = useMemo<SearchResult[]>(() => {
		const threadByMessageId = new Map<string, string | undefined>(
			filteredRows.map((row) => [row.id, row.threadId]),
		);
		const literalThreadIds = searchResults
			.map((result) => threadByMessageId.get(result.id))
			.filter((id): id is string => id != null);
		return relatedSearchResults(
			semanticHits,
			literalThreadIds,
			resultFolderIndex,
		);
	}, [semanticHits, searchResults, filteredRows, resultFolderIndex]);

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
					onShowAllSection={showAllSection}
					onRetrySection={retrySection}
					flat={underQuery}
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
						searchLoading: isLoading,
						relatedResults,
						relatedLoading,
						onSelectSearchResult: openResult,
						// The body already narrows to the committed query (the server
						// `query` on every section request, plus `matchesSearchTokens` for
						// the residue), so a committed search is a selectable list here
						// exactly as it is on the mailbox route (#212) — the two-engine
						// panel stays for the typing/uncommitted state only.
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
