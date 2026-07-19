/**
 * FlaggedList — a FLAT, cross-account inbox of starred mail.
 *
 * Reads GET /threads with `starred=true`, which is served by the `byStarred`
 * index and returns every starred thread in the config across all non-muted
 * mailboxes, paged. Starredness is decided server-side from `hasStars`; the
 * client neither re-filters nor caps the set, so a starred thread outside the
 * newest inbox page still appears. Rendered as one continuous list (no category
 * sections). The shared `MailViewChrome` owns the `MailHeader` + filter
 * expando; the kit `MessageListPane` (flat, no `briefFilters`) owns the loading
 * / empty / error chrome and keyboard hints, with a consumer-supplied
 * `listBody` so the real rows render at every width.
 */
import { unifiedThreadOperationsListAllThreadsQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { unifiedThreadOperationsListAllThreads } from "@remit/api-http-client/sdk.gen.ts";
import {
	ComfortableRow,
	flaggedFilterConfig,
	MessageListPane,
	type ThreadRowData,
} from "@remit/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import {
	matchesBriefSearch,
	matchesSearchTokens,
	toThreadRowData,
} from "@/lib/brief";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";
import { useMailContext } from "@/lib/mail-context";
import { rowToSearchResult } from "@/lib/search-result";
import { parseSearchTokens } from "@/lib/search-tokens";
import { MailViewChrome } from "./MailViewChrome";

const FILTER_PREDICATES: Record<string, (t: ThreadRowData) => boolean> = {
	unread: (t) => !t.isRead,
	attachment: (t) => t.hasAttachment === true,
};

interface FlaggedListProps {
	selectedMessageId?: string;
	onSelectMessage?: (id: string) => void;
}

export function FlaggedList({
	selectedMessageId,
	onSelectMessage,
}: FlaggedListProps) {
	const { searchQuery, mailboxNameIndex, accountNameIndex } = useMailContext();
	const isDesktop = useIsDesktop();

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
		data: threadsData,
		isLoading,
		isError,
		error,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useInfiniteQuery({
		queryKey: unifiedThreadOperationsListAllThreadsQueryKey({
			query: { starred: true },
		}),
		queryFn: async ({ pageParam }) => {
			const { data } = await unifiedThreadOperationsListAllThreads({
				query: {
					starred: true,
					order: "desc",
					continuationToken: pageParam,
				},
				throwOnError: true,
			});
			return data;
		},
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.continuationToken,
		staleTime: 60_000,
	});

	const { freeText: sq, tokens: queryTokens } = parseSearchTokens(
		searchQuery.trim().toLowerCase(),
		{ mailboxesByName: mailboxNameIndex, accountsByName: accountNameIndex },
	);

	const rows = useMemo<ThreadRowData[]>(() => {
		const predicates = Array.from(activeFilters)
			.map((id) => FILTER_PREDICATES[id])
			.filter((p): p is (t: ThreadRowData) => boolean => p != null);
		return (threadsData?.pages ?? [])
			.flatMap((page) => page.items ?? [])
			.map(toThreadRowData)
			.filter(
				(t) =>
					(selectedCategory === "all" || t.category === selectedCategory) &&
					predicates.every((p) => p(t)) &&
					(!sq || matchesBriefSearch(t, sq)) &&
					matchesSearchTokens(t, queryTokens),
			);
	}, [threadsData, selectedCategory, activeFilters, sq, queryTokens]);

	const preset = useMemo(() => flaggedFilterConfig(), []);

	const searchResults = useMemo(() => rows.map(rowToSearchResult), [rows]);

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

	const listBody = (
		<div className="flex-1 overflow-y-auto">
			<div className="divide-y divide-line">
				{rows.map((thread) => (
					<ComfortableRow
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
		>
			<MessageListPane
				listTitle="Starred"
				sections={[{ id: "flagged", threads: rows }]}
				flatList
				hideHeader
				listState={listState}
				searchQuery={sq ? searchQuery : undefined}
				errorMessage={isError ? formatErrorMessage(error) : undefined}
				onRetry={() => refetch()}
				onReportError={handleReportError}
				selectedThreadId={selectedMessageId}
				onSelectThread={onSelectMessage}
				onSelectBriefCategory={() => undefined}
				isDesktop={isDesktop}
				listBody={listState === "ready" ? listBody : undefined}
			/>
		</MailViewChrome>
	);
}
