/**
 * FlaggedList — a FLAT, cross-account inbox of starred mail.
 *
 * Reads the starred listing through `useStarredThreads` — GET /threads with
 * `starred=true`, served by the `byStarred` index — which returns every starred
 * thread in the config across all non-muted mailboxes, paged. `FlaggedPane`
 * resolves the open thread from that same hook, so every row rendered here can
 * be opened. Starredness is decided server-side from `hasStars`; the client
 * neither re-filters nor caps the set, so a starred thread outside the newest
 * inbox page still appears. Rendered as one continuous list (no category
 * sections). The shared `MailViewChrome` owns the `MailHeader` + filter
 * expando; the kit `MessageListPane` (flat, no `briefFilters`) owns the loading
 * / empty / error chrome and keyboard hints, with a consumer-supplied
 * `listBody` so the real rows render at every width.
 */
import {
	flaggedFilterConfig,
	MessageListPane,
	type ThreadRowData,
	type Verb,
} from "@remit/ui";
import { type RefObject, useCallback, useMemo, useState } from "react";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useSearchTokenContext } from "@/hooks/useSearchTokenContext";
import { useStarredThreads } from "@/hooks/useStarredThreads";
import type { TriageContextUpdate } from "@/hooks/useTriageLayer";
import {
	matchesBriefSearch,
	matchesSearchTokens,
	toThreadRowData,
} from "@/lib/brief";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";
import { useListHeaderChrome } from "@/lib/list-header-chrome";
import { useMailContext } from "@/lib/mail-context";
import { rowToSearchResult } from "@/lib/search-result";
import { parseSearchTokens } from "@/lib/search-tokens";
import { dedupeByThread } from "@/lib/starred-rows";
import { useSelectionWizard } from "@/lib/wizard-history";
import { MailViewChrome } from "./MailViewChrome";
import type { MessageListCommands } from "./MessageList";
import { MessageRow } from "./MessageRow";
import {
	SelectionWizardHost,
	type WizardSelectionMessage,
} from "./SelectionWizardHost";
import {
	type OpenMessageOptions,
	ThreadListInteraction,
	ThreadListSelectionBar,
	useThreadListSelection,
} from "./ThreadListInteraction";

const FILTER_PREDICATES: Record<string, (t: ThreadRowData) => boolean> = {
	unread: (t) => !t.isRead,
	attachment: (t) => t.hasAttachment === true,
};

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
	const selection = useMemo<WizardSelectionMessage[]>(
		() =>
			rows
				.filter((row) => selectedIds.has(row.id))
				.map((row) => ({
					id: row.id,
					sender: row.fromName,
					email: row.fromEmail,
					subject: row.subject,
					date: row.timeLabel,
				})),
		[rows, selectedIds],
	);
	return (
		<SelectionWizardHost
			verb={verb}
			selection={selection}
			crossAccount
			onFinished={exitSelection}
		/>
	);
}

interface FlaggedListProps {
	selectedMessageId?: string;
	onSelectMessage?: (id: string, options?: OpenMessageOptions) => void;
	/** Where the list publishes the commands the keyboard layer drives. */
	commandsRef?: RefObject<MessageListCommands | null>;
	/** Cursor / selection / display order, reported up to the triage layer. */
	onTriageContextChange?: (context: TriageContextUpdate) => void;
	onDeleteMessages: (messageIds: string[]) => void;
}

export function FlaggedList({
	selectedMessageId,
	onSelectMessage,
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

	const {
		threads,
		isLoading,
		isError,
		error,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useStarredThreads();

	const { freeText: sq, tokens: queryTokens } = parseSearchTokens(
		searchQuery.trim().toLowerCase(),
		tokenContext,
	);

	const rows = useMemo<ThreadRowData[]>(() => {
		const predicates = Array.from(activeFilters)
			.map((id) => FILTER_PREDICATES[id])
			.filter((p): p is (t: ThreadRowData) => boolean => p != null);
		return dedupeByThread(threads)
			.map(toThreadRowData)
			.filter(
				(t) =>
					(selectedCategory === "all" || t.category === selectedCategory) &&
					predicates.every((p) => p(t)) &&
					(!sq || matchesBriefSearch(t, sq)) &&
					matchesSearchTokens(t, queryTokens),
			);
	}, [threads, selectedCategory, activeFilters, sq, queryTokens]);

	const preset = useMemo(() => flaggedFilterConfig(), []);

	const searchResults = useMemo(
		() => rows.map((row) => rowToSearchResult(row, resultFolderIndex)),
		[rows, resultFolderIndex],
	);

	const unreadCount = useMemo(
		() => rows.filter((t) => !t.isRead).length,
		[rows],
	);

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
							onClick={() => onSelectMessage?.(thread.id)}
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
			onSelectSearchResult={(result) => onSelectMessage?.(result.id)}
			// A committed search renders in this view's own rows (`rows` already
			// narrows to the query above), so the multi-select toolbar stays
			// reachable exactly as it does on the mailbox route (#212). The
			// two-engine panel stays for the typing/uncommitted state only.
			searchResultsInBody
		>
			<ThreadListInteraction
				selectedMessageId={selectedMessageId}
				onOpen={(id, options) => onSelectMessage?.(id, options)}
				onDeleteMessages={onDeleteMessages}
				onSelectionVerb={wizard.start}
				wizardOpen={wizard.isOpen}
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
					onSelectThread={onSelectMessage}
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
