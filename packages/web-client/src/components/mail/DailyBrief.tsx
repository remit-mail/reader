/**
 * DailyBrief — unified cross-account message digest.
 *
 * Renders one section per message category (Personal / Transactional /
 * Newsletter / Marketing / Social / Automated) from the GET /threads endpoint.
 * Starred mail is not a section — Flagged is a virtual mailbox in the nav. The
 * brief defaults to the cross-account aggregate, and `MailListHeader` provides
 * the title, unread count, and search.
 *
 * The list's filter control (categories + attribute chips + the account source
 * group) is hidden — the brief is being tried without it. The kit
 * `BriefSections` renders that control above the list body, so the body is
 * rendered here by `BriefListBody` instead; every input the control consumed is
 * still computed below, so bringing it back is swapping `BriefListBody` for
 * `<BriefSections … />`. Account switching also lives in the nav sidebar, and
 * the phone search takeover keeps its own copy of the filter sheet.
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
	BriefSection,
	briefFilterConfig,
	type FilterSheetProps,
	type FilterSheetSource,
	KeyboardHintBar,
	type SearchResult,
	SelectionTopBar,
	type ThreadRowData,
	type ThreadSection,
} from "@remit/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, RefreshCw } from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useJunkMailbox } from "@/hooks/useArchiveMailbox";
import {
	isSyncingPhase,
	useInitialSyncProgress,
} from "@/hooks/useInitialSyncProgress";
import { useLabelList } from "@/hooks/useLabels";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useMoveMessages } from "@/hooks/useMoveMessages";
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
import type { ListHeaderChrome } from "@/lib/list-header-chrome";
import { useMailContext } from "@/lib/mail-context";
import { relatedSearchResults, rowToSearchResult } from "@/lib/search-result";
import { parseSearchTokens } from "@/lib/search-tokens";
import { LabelApplyTrigger } from "./LabelApplyTrigger";
import { MailListHeader, type MailListHeaderProps } from "./MailListHeader";
import type { MessageListCommands } from "./MessageList";
import { MessageRow } from "./MessageRow";
import { MoveToTrigger } from "./MoveToTrigger";
import { MobileOrganizeFlow } from "./organize/MobileOrganizeFlow";
import { OrganizeDialog } from "./organize/OrganizeDialog";
import {
	type OpenMessageOptions,
	ThreadListInteraction,
	useThreadListSelection,
} from "./ThreadListInteraction";

/* The brief's attribute chips as predicates (mirrors the kit `briefFilterChips`
   ids) so the phone search takeover narrows results the same way the list does. */
/* Page size for the unscoped cross-folder search. One page is what the takeover
   and the "Top matches" list render; the server caps it at 500. */
const UNSCOPED_SEARCH_PAGE_SIZE = 200;

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
// List body (the kit `BriefSections` body without its filter control)
// ---------------------------------------------------------------------------

interface BriefListBodyProps {
	sections: ThreadSection[];
	/** Category scope. "all" keeps the per-category sections; anything else flattens. */
	briefCategory: BriefCategoryFilter;
	selectedThreadId?: string;
	onSelectThread?: (id: string) => void;
}

/**
 * The brief's list body: one capped section per category at the "all" scope, a
 * headerless flat list once narrowed to a single category (the section headers
 * are redundant there).
 *
 * This is the kit `BriefSections` body minus the filter control it renders above
 * it. The category scope still arrives from the brief — the phone search
 * takeover's filter sheet sets it — so the flatten path stays reachable; the
 * attribute chips are part of the hidden control and narrow nothing here.
 */
function BriefListBody({
	sections,
	briefCategory,
	selectedThreadId,
	onSelectThread,
}: BriefListBodyProps) {
	const showSections = briefCategory === "all";
	const flatRows = sections
		.flatMap((section) => section.threads)
		.filter((thread) => thread.category === briefCategory);
	const empty = showSections ? sections.length === 0 : flatRows.length === 0;

	return (
		<div className="h-full overflow-y-auto">
			{showSections ? (
				sections.map((section) => (
					<BriefSection
						key={section.id}
						section={section}
						Row={MessageRow}
						selectedThreadId={selectedThreadId}
						onSelectThread={onSelectThread}
					/>
				))
			) : (
				<div className="divide-y divide-line">
					{flatRows.map((thread) => (
						<MessageRow
							key={thread.id}
							thread={thread}
							active={thread.id === selectedThreadId}
							onClick={() => onSelectThread?.(thread.id)}
						/>
					))}
				</div>
			)}
			{empty && (
				<div className="px-row-inset py-6 text-center text-2xs text-fg-subtle">
					No threads match these filters.
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Selection surface (the mailbox list's, mounted on the brief)
// ---------------------------------------------------------------------------

export interface BriefSelectionScope {
	/** Owning account, when every selected row shares one. */
	accountId?: string;
	/** Source folder, when every selected row shares one. */
	mailboxId?: string;
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
	const accountIds = new Set<string>();
	const mailboxIds = new Set<string>();
	for (const row of rows) {
		if (!selectedIds.has(row.id)) continue;
		if (row.accountId) accountIds.add(row.accountId);
		if (row.mailboxId) mailboxIds.add(row.mailboxId);
	}
	if (accountIds.size > 1) {
		return {
			moveDisabledHint:
				"Move only works within one account — clear selection or pick messages from a single account",
		};
	}
	const accountId = accountIds.size === 1 ? [...accountIds][0] : undefined;
	if (mailboxIds.size > 1) {
		return {
			accountId,
			moveDisabledHint: `Move only works within one folder — this selection spans ${mailboxIds.size} folders`,
		};
	}
	return {
		accountId,
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
	isDesktop: boolean;
	onMarkMessagesRead?: (messageIds: string[]) => void;
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
	isDesktop,
	onMarkMessagesRead,
	children,
}: BriefSelectionChromeProps) {
	const {
		selectedIds,
		selectedCount,
		exitSelection,
		requestDeleteSelection,
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
	const { moveMessages, isPending: isMoving } = useMoveMessages({
		mailboxId: scope.mailboxId ?? "",
		accountId: scope.accountId,
	});

	const [organizeOpen, setOrganizeOpen] = useState(false);
	const [mobileOrganizeEntry, setMobileOrganizeEntry] = useState<
		"select-similar" | "something-else" | null
	>(null);

	// An emptied selection takes the flows it opened with it, so a later
	// re-selection can't reopen one on a stale entry.
	useEffect(() => {
		if (selectedCount > 0) return;
		setOrganizeOpen(false);
		setMobileOrganizeEntry(null);
	}, [selectedCount]);

	const selectedMessageIds = useMemo(
		() => Array.from(selectedIds),
		[selectedIds],
	);
	const selectedSenders = useMemo(() => {
		const emails: string[] = [];
		for (const row of rows) {
			if (selectedIds.has(row.id) && row.fromEmail) emails.push(row.fromEmail);
		}
		return emails;
	}, [rows, selectedIds]);

	const handleMarkAsRead = useCallback(() => {
		onMarkMessagesRead?.(selectedMessageIds);
		exitSelection();
	}, [onMarkMessagesRead, selectedMessageIds, exitSelection]);

	const handleMove = useCallback(
		(destinationMailboxId: string) => {
			if (selectedMessageIds.length === 0) return;
			moveMessages(selectedMessageIds, destinationMailboxId);
			exitSelection();
		},
		[moveMessages, selectedMessageIds, exitSelection],
	);

	const handleJunk = useCallback(() => {
		if (junkMailboxId) handleMove(junkMailboxId);
	}, [junkMailboxId, handleMove]);

	const scoped = !!scope.accountId && !!scope.mailboxId;
	const canJunk =
		scoped && !!junkMailboxId && junkMailboxId !== scope.mailboxId;

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
			count={selectedCount}
			onCancel={exitSelection}
			onDelete={requestDeleteSelection}
			onOrganize={
				scoped
					? () =>
							isDesktop
								? setOrganizeOpen(true)
								: setMobileOrganizeEntry("select-similar")
					: undefined
			}
			onJunk={canJunk ? handleJunk : undefined}
			onMarkRead={onMarkMessagesRead ? handleMarkAsRead : undefined}
			onSomethingElse={
				scoped && !isDesktop
					? () => setMobileOrganizeEntry("something-else")
					: undefined
			}
			moveSlot={
				scoped && scope.accountId && scope.mailboxId ? (
					<MoveToTrigger
						accountId={scope.accountId}
						currentMailboxId={scope.mailboxId}
						onMove={isMoving ? () => {} : handleMove}
						label="Move selected messages"
					/>
				) : undefined
			}
			overflowSlot={
				scope.accountId &&
				scope.mailboxId &&
				selectedCount > 0 &&
				labels.length > 0 ? (
					<LabelApplyTrigger
						variant="menu-row"
						accountId={scope.accountId}
						mailboxId={scope.mailboxId}
						messageIds={selectedMessageIds}
					/>
				) : undefined
			}
			isBusy={isMoving}
			selectAll={selectAll}
			notice={notice}
		/>
	);

	const organizeFlow =
		mobileOrganizeEntry &&
		scope.accountId &&
		!isDesktop &&
		selectedCount > 0 ? (
			<MobileOrganizeFlow
				entry={mobileOrganizeEntry}
				accountId={scope.accountId}
				selectedMessageIds={selectedMessageIds}
				selectedSenders={selectedSenders}
				junkMailboxId={junkMailboxId}
				onClose={() => {
					setMobileOrganizeEntry(null);
					exitSelection();
				}}
			/>
		) : undefined;

	return (
		<>
			<MailListHeader
				{...header}
				selectionBar={selectionBar}
				paneOverlay={organizeFlow}
			>
				{children}
			</MailListHeader>
			{organizeOpen && scope.accountId && (
				<OrganizeDialog
					open={organizeOpen}
					accountId={scope.accountId}
					selectedMessageIds={selectedMessageIds}
					selectedSenders={selectedSenders}
					onClose={() => setOrganizeOpen(false)}
				/>
			)}
		</>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DailyBriefProps {
	accounts: RemitImapAccountResponse[];
	selectedMessageId?: string;
	/** Opens an in-list brief row (resolved by messageId against the loaded list). */
	onSelectMessage?: (id: string, options?: OpenMessageOptions) => void;
	/**
	 * Opens a search result. A semantic "Related" hit carries its thread + mailbox
	 * so it opens even when its message isn't in the loaded brief list.
	 */
	onSelectSearchResult?: (result: SearchResult) => void;
	/** Where the list publishes the commands the keyboard layer drives. */
	commandsRef?: RefObject<MessageListCommands | null>;
	/** Cursor / selection / display order, reported up to the triage layer. */
	onTriageContextChange?: (context: TriageContextUpdate) => void;
	onDeleteMessages?: (messageIds: string[]) => void;
	onMarkMessagesRead?: (messageIds: string[]) => void;
}

export function DailyBrief({
	accounts,
	selectedMessageId,
	onSelectMessage,
	onSelectSearchResult,
	commandsRef,
	onTriageContextChange,
	onDeleteMessages,
	onMarkMessagesRead,
}: DailyBriefProps) {
	const { searchQuery, resultFolderIndex } = useMailContext();
	const tokenContext = useSearchTokenContext();
	const isDesktop = useIsDesktop();

	const nonMuted = useMemo(
		() => sortAccountsByCreatedAt(accounts.filter((a) => !a.muted?.value)),
		[accounts],
	);

	// "all" = the cross-account aggregate (the brief's default), and "all"
	// categories = the full set of sections. Both stay at their default while the
	// list's filter control is hidden; the phone search takeover still drives them
	// (the category also drives the flatten-when-filtered path), and account
	// switching lives in the nav sidebar.
	const [selectedAccountId, setSelectedAccountId] = useState("all");
	const [selectedCategory, setSelectedCategory] =
		useState<BriefCategoryFilter>("all");

	// Attribute chips for the phone search takeover — a separate surface from the
	// list, so it carries its own additive set (category + account are shared
	// above) and keeps its filter sheet while the list's control is hidden.
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
			.map((row) => rowToSearchResult(row, resultFolderIndex));
	}, [filteredRows, selectedCategory, searchAttributes, resultFolderIndex]);

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
	// the list says so instead, so the narrowing is still visible as the reason.
	const caughtUp =
		sections.length === 0 && selectedAccountId === "all" && sq.length === 0;

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

	const stateBody = isLoading ? (
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
	) : caughtUp ? (
		syncProgress.resolved ? (
			<BriefEmpty
				sync={
					syncProgress.syncing
						? { synced: syncProgress.synced, total: syncProgress.total }
						: undefined
				}
			/>
		) : (
			briefSkeleton
		)
	) : (
		<BriefListBody
			sections={sections}
			briefCategory={selectedCategory}
			selectedThreadId={selectedMessageId}
			onSelectThread={onSelectMessage}
		/>
	);

	// The cursor and selection wrap the whole pane, not just the list body: the
	// selection toolbar takes the header's place while rows are selected, so it
	// has to sit inside the same provider the rows do.
	return (
		<ThreadListInteraction
			selectedMessageId={selectedMessageId}
			onOpen={(id, options) => onSelectMessage?.(id, options)}
			onDeleteMessages={onDeleteMessages}
			commandsRef={commandsRef}
			onTriageContextChange={onTriageContextChange}
		>
			<BriefSelectionChrome
				header={{
					title: "Daily brief",
					unreadCount: totalUnseen,
					footer: isDesktop ? <KeyboardHintBar /> : undefined,
					searchFilter: searchFilterConfig,
					searchResults,
					searchLoading: isLoading || searchFetching,
					relatedResults,
					relatedLoading,
					onSelectSearchResult,
				}}
				rows={filteredRows}
				isDesktop={isDesktop}
				onMarkMessagesRead={onMarkMessagesRead}
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
	);
}
