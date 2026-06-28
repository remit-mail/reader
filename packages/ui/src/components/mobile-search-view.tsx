import { ArrowLeft } from "lucide-react";
import { Button } from "./button.js";
import { FilterSheet, type FilterSheetProps } from "./filter-sheet.js";
import { SearchBar } from "./search-bar.js";
import { type SearchResultSection, SearchResults } from "./search-results.js";

export interface MobileSearchViewProps {
	value: string;
	onChange: (value: string) => void;
	onClear: () => void;
	/** Dismiss the search takeover and return to the list. */
	onCancel: () => void;
	/**
	 * The shared FilterSheet config (categories + Unread/Flagged/attachment, plus
	 * the brief-only account source row). Feed it `briefFilterConfig(accounts)` or
	 * `inboxFilterConfig()` from `filter-presets`. Omit to drop the filter chrome.
	 */
	filter?: Omit<FilterSheetProps, "children">;
	/** Recent searches shown when the query is empty. */
	recentSearches?: string[];
	onPickRecent?: (query: string) => void;
	/** Grouped result sections (e.g. "Top matches", "Related"). */
	sections?: SearchResultSection[];
	loading?: boolean;
	onSelectResult?: (id: string) => void;
}

/**
 * The full-screen mobile search takeover. Mirrors `MobileReadingPane` chrome: a
 * fixed top bar with a ghost cancel button and the shared `SearchBar`. Below the
 * bar the shared `SearchResults` body rides inside the shared `FilterSheet` (the
 * same categories, Unread/Flagged/attachment toggles, and brief-only account row
 * the inboxes use) so search carries identical filters; pass no `filter` to drop
 * the chrome. Desktop reuses the same `SearchResults` body in the list pane.
 * Presentational and prop-driven.
 */
export function MobileSearchView({
	value,
	onChange,
	onClear,
	onCancel,
	filter,
	recentSearches,
	onPickRecent,
	sections,
	loading,
	onSelectResult,
}: MobileSearchViewProps) {
	const body = (
		<SearchResults
			value={value}
			recentSearches={recentSearches}
			onPickRecent={onPickRecent}
			sections={sections}
			loading={loading}
			onSelectResult={onSelectResult}
		/>
	);

	return (
		<article className="flex h-full w-full min-w-0 flex-col bg-canvas">
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line bg-surface px-row-inset">
				<Button
					variant="ghost"
					size="sm"
					icon={<ArrowLeft className="size-4" />}
					onClick={onCancel}
					aria-label="Cancel search"
					className="-ml-1 shrink-0"
				/>
				<div className="min-w-0 flex-1">
					<SearchBar
						value={value}
						onChange={onChange}
						onClear={onClear}
						globalFocusKey={false}
					/>
				</div>
			</header>

			{filter ? (
				<FilterSheet {...filter}>{body}</FilterSheet>
			) : (
				<div className="flex-1 overflow-y-auto">{body}</div>
			)}
		</article>
	);
}
