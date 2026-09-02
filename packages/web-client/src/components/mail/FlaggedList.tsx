/**
 * FlaggedList — a FLAT, cross-account inbox of starred mail.
 *
 * Reads the starred listing through `useStarredThreads` — GET /threads with
 * `starred=true`, served by the `byStarred` index — which returns every starred
 * thread in the config across all non-muted mailboxes, paged. Every row names
 * its thread, which is the whole address a conversation opens by, so a starred
 * message filed outside the inbox opens like any other. Starredness is decided
 * server-side from `hasStars`; the client neither re-filters nor caps the set,
 * so a starred thread outside the newest inbox page still appears. Rendered as
 * one continuous list (no category sections). The shared `MailViewChrome` owns
 * the `MailHeader` + filter expando; the kit `MessageListPane` (flat, no
 * `briefFilters`) owns the loading / empty / error chrome and keyboard hints,
 * with a consumer-supplied `listBody` so the real rows render at every width.
 *
 * The category and attribute chips are query parameters, and the header's
 * unread count is the server's own (#308). Both used to be computed over the
 * pages the user happened to have loaded, so a category whose mail sat below
 * the newest page showed an empty list, and the count grew with every press of
 * "load more" while being presented as a total.
 */
import {
	flaggedFilterConfig,
	MessageListPane,
	type SearchResult,
	type ThreadRowData,
	type Verb,
} from "@remit/ui";
import { type RefObject, useCallback, useMemo, useState } from "react";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useSearchTokenContext } from "@/hooks/useSearchTokenContext";
import {
	useStarredTextSearch,
	useStarredThreads,
	useStarredUnreadCount,
} from "@/hooks/useStarredThreads";
import type { TriageContextUpdate } from "@/hooks/useTriageLayer";
import {
	matchesBriefSearch,
	matchesSearchTokens,
	mergeSearchRows,
	toThreadRowData,
} from "@/lib/brief";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";
import { inboxFilterParams } from "@/lib/inbox-filters";
import { useListHeaderChrome } from "@/lib/list-header-chrome";
import { useMailContext } from "@/lib/mail-context";
import { rowToSearchResult } from "@/lib/search-result";
import { parseSearchTokens } from "@/lib/search-tokens";
import { dedupeByThread } from "@/lib/starred-rows";
import { wizardSelectionFrom } from "@/lib/wizard-selection";
import type { OpenThreadTarget } from "@/routing";
import { useSelectionWizard } from "@/routing";
import { MailViewChrome } from "./MailViewChrome";
import type { MessageListCommands } from "./MessageList";
import { MessageRow } from "./MessageRow";
import { SelectionWizardHost } from "./SelectionWizardHost";
import {
	type OpenMessageOptions,
	ThreadListInteraction,
	ThreadListSelectionBar,
	useThreadListSelection,
} from "./ThreadListInteraction";

/** One page of the server-filtered text search, merged with the listing below. */
const TEXT_SEARCH_PAGE_SIZE = 200;

/**
 * The wizard this view's verbs walk, and the one its search entry lands on.
 *
 * The bar's Delete and Mark read open it on the ticked rows, so a bulk action
 * here is reviewed exactly as it is on the mailbox list. The list header also
 * offers "make this a filter" wherever a search is active, and the step that
 * affordance pushes has to be answered on the view that offered it — an
 * affordance whose press lands on nothing is the dead button clause 1.7 exists
 * to prevent. Starred spans accounts and mailboxes, so a rule made from the
 * ticked rows has no single account to belong to; a rule made from the query
 * belongs to the account the query names, which the host reads for itself.
 */
function StarredWizardHost({
	rows,
	verb,
}: {
	rows: readonly ThreadRowData[];
	verb: Verb;
}) {
	const { selectedIds, exitSelection } = useThreadListSelection();
	const selection = useMemo(
		() => wizardSelectionFrom(rows, selectedIds),
		[rows, selectedIds],
	);
	return (
		<SelectionWizardHost
			verb={verb}
			selection={selection}
			selectionRestriction="spansAccounts"
			onFinished={exitSelection}
		/>
	);
}

interface FlaggedListProps {
	selectedMessageId?: string;
	/**
	 * Opens a row. Every starred row names its thread, so a message filed outside
	 * the inbox opens by exactly the same route as one inside it.
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

export function FlaggedList({
	selectedMessageId,
	onOpenThread,
	commandsRef,
	onTriageContextChange,
	onDeleteMessages,
}: FlaggedListProps) {
	const { searchQuery, resultFolderIndex } = useMailContext();
	const tokenContext = useSearchTokenContext();
	const isDesktop = useIsDesktop();
	const wizard = useSelectionWizard();

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
	}, []);

	const { freeText: sq, tokens: queryTokens } = parseSearchTokens(
		searchQuery.trim().toLowerCase(),
		tokenContext,
	);

	// The chips as query parameters. `inboxFilterParams` translates the same chip
	// ids the inbox uses, and `listAllThreads` takes the same parameters, so the
	// two views narrow their lists through one translation rather than two.
	const filterParams = useMemo(
		() =>
			inboxFilterParams({
				category: selectedCategory,
				attributes: activeFilters,
			}),
		[selectedCategory, activeFilters],
	);
	const textCriteria = useMemo(
		() => (sq ? { ...filterParams, query: sq } : filterParams),
		[filterParams, sq],
	);

	const {
		threads,
		isLoading,
		isError,
		error,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useStarredThreads(filterParams);
	const textMatches = useStarredTextSearch(textCriteria, TEXT_SEARCH_PAGE_SIZE);

	const rows = useMemo<ThreadRowData[]>(() => {
		const listed = dedupeByThread(threads).map(toThreadRowData);
		// No free text: the server-filtered listing as it comes.
		const matched = sq
			? mergeSearchRows(
					// The snippet half, over the rows already loaded. It only ever adds
					// to the server's set — it is never what decides membership.
					listed.filter((t) => matchesBriefSearch(t, sq)),
					dedupeByThread(textMatches).map(toThreadRowData),
				)
			: listed;
		// `before:`/`after:`/`in:`/`account:` have no parameter on this endpoint,
		// so they stay a pass over the rows the server returned. The collapse runs
		// last so the two halves of a text search cannot land the same
		// conversation twice.
		return dedupeByThread(matched).filter((t) =>
			matchesSearchTokens(t, queryTokens),
		);
	}, [threads, textMatches, sq, queryTokens]);

	const openRow = useCallback(
		(id: string, options?: OpenMessageOptions) => {
			const threadId = rows.find((row) => row.id === id)?.threadId;
			if (!threadId) return;
			onOpenThread?.({ threadId, messageId: id }, options);
		},
		[rows, onOpenThread],
	);

	// The two-engine results panel, whose semantic hits are in no list at all —
	// each one carries the thread it belongs to.
	const openResult = useCallback(
		(result: SearchResult) => {
			const threadId =
				result.threadId ?? rows.find((row) => row.id === result.id)?.threadId;
			if (!threadId) return;
			onOpenThread?.({ threadId, messageId: result.id });
		},
		[rows, onOpenThread],
	);

	const preset = useMemo(() => flaggedFilterConfig(), []);

	const searchResults = useMemo(
		() => rows.map((row) => rowToSearchResult(row, resultFolderIndex)),
		[rows, resultFolderIndex],
	);

	// The server's count over the whole collection under the active criteria.
	// Undefined while it is in flight and undefined when it cannot be had, and
	// the header then shows no number — never a page length dressed as a total.
	const unreadCount = useStarredUnreadCount(textCriteria);

	const listState = isLoading
		? "loading"
		: isError
			? "error"
			: rows.length === 0
				? "empty"
				: "ready";

	const handleReportError = useCallback(() => {
		const url = buildGitHubIssueUrl(buildBugReportContext());
		window.open(url, "_blank", "noopener,noreferrer");
	}, []);

	const chrome = useListHeaderChrome();
	const listBody = (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex-1 overflow-y-auto">
				<div className="divide-y divide-line">
					{rows.map((thread) => (
						<MessageRow
							key={thread.id}
							thread={thread}
							active={thread.id === selectedMessageId}
							onClick={() => openRow(thread.id)}
						/>
					))}
				</div>
				{hasNextPage ? (
					<button
						type="button"
						className="w-full py-3 text-sm text-muted hover:text-fg disabled:opacity-50"
						onClick={() => fetchNextPage()}
						disabled={isFetchingNextPage}
					>
						{isFetchingNextPage ? "Loading…" : "Load more"}
					</button>
				) : null}
			</div>
		</div>
	);

	return (
		<MailViewChrome
			title="Starred"
			unreadCount={unreadCount}
			preset={preset}
			selectedCategory={selectedCategory}
			activeFilters={activeFilters}
			onSelectCategory={setSelectedCategory}
			onToggleFilter={toggleFilter}
			onClearFilters={clearFilters}
			searchResults={searchResults}
			searchLoading={isLoading}
			onSelectSearchResult={openResult}
			// A committed search renders in this view's own rows (`rows` already
			// narrows to the query above), so the multi-select toolbar stays
			// reachable exactly as it does on the mailbox route (#212). The
			// two-engine panel stays for the typing/uncommitted state only.
			searchResultsInBody
		>
			<ThreadListInteraction
				selectedMessageId={selectedMessageId}
				rows={rows}
				onOpen={openRow}
				onDeleteMessages={onDeleteMessages}
				onSelectionVerb={wizard.start}
				commandsRef={commandsRef}
				onTriageContextChange={onTriageContextChange}
			>
				<MessageListPane
					listTitle="Starred"
					sections={[{ id: "flagged", threads: rows }]}
					flatList
					hideHeader
					listState={chrome.searchResults ? "ready" : listState}
					searchQuery={sq ? searchQuery : undefined}
					errorMessage={isError ? formatErrorMessage(error) : undefined}
					onRetry={() => refetch()}
					onReportError={handleReportError}
					selectedThreadId={selectedMessageId}
					onSelectThread={openRow}
					isDesktop={isDesktop}
					selectionBar={<ThreadListSelectionBar title="Starred" />}
					listBody={
						chrome.searchResults ??
						(listState === "ready" ? listBody : undefined)
					}
				/>
				<StarredWizardHost rows={rows} verb={wizard.verb} />
			</ThreadListInteraction>
		</MailViewChrome>
	);
}
