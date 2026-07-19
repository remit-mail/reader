import { X } from "lucide-react";
import { Button } from "./button.js";
import { FilterSheet, type FilterSheetProps } from "./filter-sheet.js";
import { SearchBar } from "./search-bar.js";
import type { SearchChip } from "./search-chip-input.js";
import type { SearchResult } from "./search-result-row.js";
import { type SearchResultSection, SearchResults } from "./search-results.js";

export interface MobileSearchViewProps {
	value: string;
	onChange: (value: string) => void;
	/** Query-only clear (Esc key). The visible X uses {@link onCancel}. */
	onClear: () => void;
	/**
	 * The single dismiss control (X): clears the query AND closes the takeover so
	 * the view returns to the plain list with no stranded query/URL state.
	 */
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
	onSelectResult?: (result: SearchResult) => void;
	/** Active filter-token chips parsed from the query; see `SearchResultsProps`. */
	tokens?: { label: string; onRemove: () => void }[];
	/**
	 * Narrowing terms rendered inline inside the search field, as part of the
	 * editable expression — the same `SearchChipInput` the desktop top bar uses.
	 * Supersedes `tokens` for chips the user can act on: `tokens` renders them as
	 * a static row above the results, `chips` puts them in the field where
	 * backspace and the caret keys reach them.
	 */
	chips?: readonly SearchChip[];
	onRemoveChip?: (id: string) => void;
}

/**
 * The full-screen mobile search takeover. Mirrors `MobileReadingPane` chrome: a
 * fixed top bar with the shared `SearchBar` and a single X that both clears the
 * query and dismisses the takeover (the bar's own inline clear is suppressed so
 * there is exactly one X). Below the bar the shared `SearchResults` body rides
 * inside the shared `FilterSheet` (the
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
	tokens,
	chips,
	onRemoveChip,
}: MobileSearchViewProps) {
	const body = (
		<SearchResults
			value={value}
			recentSearches={recentSearches}
			onPickRecent={onPickRecent}
			sections={sections}
			loading={loading}
			onSelectResult={onSelectResult}
			tokens={tokens}
		/>
	);

	return (
		<article className="flex h-full w-full min-w-0 flex-col bg-canvas">
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line bg-surface px-row-inset">
				<div className="min-w-0 flex-1">
					<SearchBar
						value={value}
						onChange={onChange}
						onClear={onClear}
						chips={chips}
						onRemoveChip={onRemoveChip}
						globalFocusKey={false}
						showClearButton={false}
					/>
				</div>
				<Button
					variant="ghost"
					size="sm"
					icon={<X className="size-4" />}
					onClick={onCancel}
					aria-label="Clear and close search"
					className="-mr-1 shrink-0"
				/>
			</header>

			{filter ? (
				<FilterSheet {...filter}>{body}</FilterSheet>
			) : (
				<div className="flex-1 overflow-y-auto">{body}</div>
			)}
		</article>
	);
}
