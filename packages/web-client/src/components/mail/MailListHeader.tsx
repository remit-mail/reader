/**
 * MailListHeader — the header-only list-pane shell shared by every list view.
 *
 * Composes the kit `MailHeader` (hamburger + title + unread + search) and the
 * `<section>` column shell with an optional pinned footer. It owns no filter
 * surface: the daily brief lets the kit `BriefSections` own the filter row,
 * while `MailViewChrome` slots a `FilterSheet` into the body for the inbox /
 * flagged views.
 *
 * Search comes from `MailContext` (one source of truth, mirrored to the URL).
 * On phone the magnifier opens a full-screen `MobileSearchView` takeover instead
 * of expanding over the title; tablet and desktop keep the inline header search
 * and, once a query is present, swap the list-pane body to the same kit
 * `SearchResults` sections under the shared `FilterSheet`. Consumers feed the
 * filter chrome and query-narrowed results; both tiers render identical rows.
 *
 * Results split into two sections: "Top matches" (literal/instant search) and
 * "Related" (semantic). The consumer dedupes them — a thread in both appears
 * only under "Top matches". Each loads independently; an empty section drops out
 * kit-side, so a "Related"-only result still shows when the literal search finds
 * nothing. The hamburger opens the nav drawer via the enclosing `AppShellSlotted`.
 */
import {
	FilterSheet,
	type FilterSheetProps,
	MailHeader,
	MobileSearchView,
	type SearchResult,
	type SearchResultSection,
	SearchResults,
	useAppShellLayout,
} from "@remit/ui";
import { type ReactNode, useState } from "react";
import { useLayoutTier } from "@/hooks/useLayoutTier";
import { useMailContext } from "@/lib/mail-context";
import { loadRecentSearches, saveRecentSearch } from "@/lib/recent-searches";

interface MailListHeaderProps {
	title: string;
	unreadCount: number;
	/** The list body (filter sheet / sections / virtualized rows). */
	children: ReactNode;
	/** Pinned below the scrollable list (e.g. the keyboard hint bar). */
	footer?: ReactNode;
	/** Filter chrome for the phone search takeover. Omit to drop the filter row. */
	searchFilter?: Omit<FilterSheetProps, "children">;
	/** Literal/instant results — the "Top matches" section. */
	searchResults?: SearchResult[];
	searchLoading?: boolean;
	/** Semantic results — the "Related" section, deduped against "Top matches". */
	relatedResults?: SearchResult[];
	relatedLoading?: boolean;
	onSelectSearchResult?: (id: string) => void;
}

export function MailListHeader({
	title,
	unreadCount,
	children,
	footer,
	searchFilter,
	searchResults,
	searchLoading,
	relatedResults,
	relatedLoading,
	onSelectSearchResult,
}: MailListHeaderProps) {
	const { searchInput, onSearchChange, onSearchClear } = useMailContext();
	const layout = useAppShellLayout();
	const tier = useLayoutTier();
	const [searchOpen, setSearchOpen] = useState(false);
	const [recentSearches, setRecentSearches] = useState(loadRecentSearches);

	const hasQuery = searchInput.trim().length > 0;
	const topMatches = searchResults ?? [];
	const related = relatedResults ?? [];
	// Always offer both sections while a query is present; the kit drops the empty
	// ones, so a "Related"-only hit still shows and two empties fall to its empty
	// state. The empty-query case (recent searches) is the kit's job.
	const sections: SearchResultSection[] = hasQuery
		? [
				{ id: "top", label: "Top matches", results: topMatches },
				{ id: "related", label: "Related", results: related },
			]
		: [];
	// Skeleton only while nothing is in yet — once either section has rows, show
	// them and let the other arrive (or not). Keeps the two sources independent.
	const hasAnyResult = topMatches.length + related.length > 0;
	const resultsLoading =
		!hasAnyResult && (searchLoading === true || relatedLoading === true);

	if (tier === "phone" && searchOpen) {
		const handleSelectResult = (id: string) => {
			setRecentSearches(saveRecentSearch(searchInput));
			setSearchOpen(false);
			onSearchClear();
			onSelectSearchResult?.(id);
		};
		return (
			<MobileSearchView
				value={searchInput}
				onChange={onSearchChange}
				onClear={onSearchClear}
				onCancel={() => {
					setSearchOpen(false);
					onSearchClear();
				}}
				filter={searchFilter}
				recentSearches={recentSearches}
				onPickRecent={onSearchChange}
				sections={sections}
				loading={resultsLoading}
				onSelectResult={handleSelectResult}
			/>
		);
	}

	// Tablet + desktop keep the inline toolbar search; once a query is present the
	// list-pane body swaps to the same sectioned results the phone takeover shows,
	// under the same FilterSheet. Clearing the query restores the normal list.
	const showInlineResults = tier !== "phone" && hasQuery;
	const handleSelectInlineResult = (id: string) => {
		setRecentSearches(saveRecentSearch(searchInput));
		onSelectSearchResult?.(id);
	};
	const results = (
		<SearchResults
			value={searchInput}
			sections={sections}
			loading={resultsLoading}
			onSelectResult={handleSelectInlineResult}
		/>
	);
	const body = !showInlineResults ? (
		children
	) : searchFilter ? (
		<FilterSheet {...searchFilter}>{results}</FilterSheet>
	) : (
		<div className="h-full overflow-y-auto">{results}</div>
	);

	return (
		<section className="flex h-full w-full flex-col bg-surface">
			<MailHeader
				title={title}
				unreadCount={unreadCount}
				// The list pane is narrow even on desktop, and the reading-pane
				// toolbar owns the wide search; keep the header's search compact (a
				// magnifier) at every width. On phone the magnifier opens the
				// full-screen takeover above; on tablet it expands over the title.
				isDesktop={false}
				onMenuClick={() => layout?.openNav()}
				searchValue={searchInput}
				onSearchChange={onSearchChange}
				onSearchClear={onSearchClear}
				searchOpen={searchOpen}
				onSearchOpenChange={setSearchOpen}
			/>
			<div className="min-h-0 flex-1">{body}</div>
			{footer}
		</section>
	);
}
