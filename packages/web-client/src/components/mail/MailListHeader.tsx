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
 * of expanding over the title; tablet and desktop keep the inline header search.
 * Consumers feed the takeover its filter chrome and query-narrowed results.
 * The hamburger opens the nav drawer via the enclosing `AppShellSlotted`.
 */
import {
	type FilterSheetProps,
	MailHeader,
	type MobileSearchSection,
	MobileSearchView,
	type SearchResult,
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
	/** Query-narrowed results shown in the phone search takeover. */
	searchResults?: SearchResult[];
	searchLoading?: boolean;
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
	onSelectSearchResult,
}: MailListHeaderProps) {
	const { searchInput, onSearchChange, onSearchClear } = useMailContext();
	const layout = useAppShellLayout();
	const tier = useLayoutTier();
	const [searchOpen, setSearchOpen] = useState(false);
	const [recentSearches, setRecentSearches] = useState(loadRecentSearches);

	if (tier === "phone" && searchOpen) {
		const sections: MobileSearchSection[] =
			searchResults && searchResults.length > 0
				? [{ id: "results", label: "Results", results: searchResults }]
				: [];
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
				loading={searchLoading}
				onSelectResult={handleSelectResult}
			/>
		);
	}

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
			<div className="min-h-0 flex-1">{children}</div>
			{footer}
		</section>
	);
}
