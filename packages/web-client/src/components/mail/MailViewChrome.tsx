/**
 * MailViewChrome — the shared list-pane chrome for the inbox and flagged views.
 *
 * Wraps the header-only `MailListHeader` and slots the `FilterSheet` expando
 * directly into its body, exactly as the kit story does. The caller supplies the
 * filter preset (`inboxFilterConfig` / `flaggedFilterConfig`) and owns the
 * category / attribute / source selection state. The same filter config feeds
 * the phone search takeover (via `MailListHeader`), so filters carry across.
 *
 * The daily brief no longer uses this: it composes `MailListHeader` with the kit
 * `BriefSections`, which owns its own filter row (so there is exactly one filter
 * surface and the section headers flatten correctly when filtered).
 */
import {
	type FilterPreset,
	FilterSheet,
	type FilterSheetProps,
	type SearchResult,
} from "@remit/ui";
import { type ReactNode, useState } from "react";
import { MailListHeader } from "./MailListHeader";

interface MailViewChromeProps {
	title: string;
	unreadCount: number;
	preset: FilterPreset;
	selectedCategory: string;
	activeFilters: ReadonlySet<string>;
	onSelectCategory: (id: string) => void;
	onToggleFilter: (id: string) => void;
	onSelectSource?: (id: string) => void;
	onClearFilters: () => void;
	/** The list body (sections / virtualized rows) rendered inside the expando. */
	children: ReactNode;
	/** Pinned below the scrollable list (e.g. the keyboard hint bar). */
	footer?: ReactNode;
	/** Literal/instant results — the "Top matches" section. */
	searchResults?: SearchResult[];
	searchLoading?: boolean;
	/** Semantic results — the "Related" section. */
	relatedResults?: SearchResult[];
	relatedLoading?: boolean;
	onSelectSearchResult?: (result: SearchResult) => void;
}

export function MailViewChrome({
	title,
	unreadCount,
	preset,
	selectedCategory,
	activeFilters,
	onSelectCategory,
	onToggleFilter,
	onSelectSource,
	onClearFilters,
	children,
	footer,
	searchResults,
	searchLoading,
	relatedResults,
	relatedLoading,
	onSelectSearchResult,
}: MailViewChromeProps) {
	const [expanded, setExpanded] = useState(false);

	const filterConfig: Omit<FilterSheetProps, "children"> = {
		categories: preset.categories,
		filters: preset.filters,
		sources: preset.sources,
		selectedCategory,
		activeFilters,
		expanded,
		onExpandedChange: setExpanded,
		onSelectCategory,
		onSelectSource,
		onToggleFilter,
		onClear: onClearFilters,
	};

	return (
		<MailListHeader
			title={title}
			unreadCount={unreadCount}
			footer={footer}
			searchFilter={filterConfig}
			searchResults={searchResults}
			searchLoading={searchLoading}
			relatedResults={relatedResults}
			relatedLoading={relatedLoading}
			onSelectSearchResult={onSelectSearchResult}
		>
			<FilterSheet {...filterConfig}>{children}</FilterSheet>
		</MailListHeader>
	);
}
