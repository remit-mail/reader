import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button.js";
import {
	FilterPanelBoundary,
	FilterSheet,
	type FilterSheetProps,
} from "./filter-sheet.js";
import { SearchBar } from "./search-bar.js";
import type { SearchChip, SearchFieldSuggest } from "./search-chip-input.js";
import type { SearchResult } from "./search-result-row.js";
import {
	type MakeFilterActionProps,
	type SearchResultSection,
	SearchResults,
	type SearchScope,
} from "./search-results.js";

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
	 * the brief-only account source row), shown over the recent searches while the
	 * field is empty. Feed it `briefFilterConfig(accounts)` or `inboxFilterConfig()`
	 * from `filter-presets`. Omit to drop the filter chrome. A query supersedes it —
	 * see the component doc.
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
	/** What the search covers; see `SearchResultsProps`. Defaults to global. */
	scope?: SearchScope;
	/** "Make this a filter" affordance; see `SearchResultsProps`. */
	makeFilter?: MakeFilterActionProps;
	/** Completions for what is being typed; see `SearchChipInput`. */
	suggest?: SearchFieldSuggest;
	/**
	 * The suggestion list itself, rendered directly under the field and above
	 * the results. In flow rather than over them: on a phone the soft keyboard
	 * takes the lower half of the screen, and a list floating over the field
	 * would hide the query it is completing.
	 */
	suggestList?: ReactNode;
}

/**
 * The full-screen mobile search takeover. Mirrors `MobileReadingPane` chrome: a
 * fixed top bar with the shared `SearchBar` and a single X that both clears the
 * query and dismisses the takeover (the bar's own inline clear is suppressed so
 * there is exactly one X). Below the bar the shared `SearchResults` body rides
 * inside the shared `FilterSheet` (the
 * same categories, Unread/Flagged/attachment toggles, and brief-only account row
 * the inboxes use); pass no `filter` to drop the chrome. Desktop reuses the same
 * `SearchResults` body in the list pane. Presentational and prop-driven.
 *
 * A query supersedes the filter row. The two narrow the same list by the same
 * intent, and the row and the search's own "Make this a filter" affordance sit in
 * the same place, so the filter chrome belongs to the empty field: it covers the
 * recent searches, and the moment something is typed the results and their
 * affordance take the space. Clearing the field brings it back.
 *
 * Completions for what is being typed sit between the field and the body, so
 * the list takes its own space rather than covering either of them.
 *
 * Search scope passes straight through, so the phone tier holds spam out,
 * offers it and labels provenance on exactly the same terms as desktop.
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
	scope,
	makeFilter,
	suggest,
	suggestList,
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
			scope={scope}
			makeFilter={makeFilter}
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
						suggest={suggest}
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

			{suggestList}

			{filter && value.trim().length === 0 ? (
				<FilterPanelBoundary>
					<FilterSheet {...filter}>{body}</FilterSheet>
				</FilterPanelBoundary>
			) : (
				<div className="flex-1 overflow-y-auto">{body}</div>
			)}
		</article>
	);
}
