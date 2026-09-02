/**
 * MailViewChrome — the shared list-pane chrome for the inbox and flagged views.
 *
 * Wraps `MailListHeader` and slots the `FilterSheet` expando
 * directly into its body, exactly as the kit story does. The caller supplies the
 * filter preset (`inboxFilterConfig` / `flaggedFilterConfig`) and owns the
 * category / attribute / source selection state. The same filter config feeds
 * the phone search takeover (via `MailListHeader`), so filters carry across.
 *
 * An active search takes the sheet down. Filtering and searching narrow the same
 * list by the same intent, and the sheet and the search's "Make this a filter"
 * affordance want the same row above the list, so only one of them is up at a
 * time. The selection state is held here and survives, so clearing the query
 * restores the sheet exactly as it was.
 *
 * The daily brief composes the same three parts itself — provider, header,
 * sheet — around the kit `BriefSections`, whose sheet narrows the grouped
 * sections and flattens them when scoped to one category.
 */
import {
	FilterPanelProvider,
	type FilterPreset,
	FilterSheet,
	type FilterSheetProps,
	type SearchResult,
} from "@remit/ui";
import type { ReactNode } from "react";
import { useMailContext } from "@/lib/mail-context";
import { MailListHeader } from "./MailListHeader";

interface MailViewChromeProps {
	title: string;
	/** Unread count beside the title; `null` shows no number — see `MailListHeader`. */
	unreadCount: number | null;
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
	/** Section headings; see `MailListHeader`. */
	searchResultsLabel?: string;
	relatedResultsLabel?: string;
	/**
	 * The body renders the committed search as a selectable list itself; see
	 * `MailListHeader`. The mailbox route sets this so a committed search yields
	 * its multi-select `MessageList` (#212); Starred sets it for the same reason,
	 * over its own already query-narrowed rows.
	 */
	searchResultsInBody?: boolean;
	/** The view's own refresh control, scoped to the account it shows. */
	refreshControl?: ReactNode;
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
	searchResultsLabel,
	relatedResultsLabel,
	searchResultsInBody,
	refreshControl,
}: MailViewChromeProps) {
	// A query owns the pane: the filter chrome and the search's own affordance
	// narrow the same list from the same place, so the filter sheet stands down
	// for as long as something is being searched. Its state survives — clearing
	// the query brings the sheet back with the same category and toggles.
	const { searchInput } = useMailContext();
	const searching = searchInput.trim().length > 0;

	const filterConfig: Omit<FilterSheetProps, "children"> = {
		categories: preset.categories,
		filters: preset.filters,
		sources: preset.sources,
		selectedCategory,
		activeFilters,
		onSelectCategory,
		onSelectSource,
		onToggleFilter,
		onClear: onClearFilters,
	};

	return (
		<FilterPanelProvider hasSheet={!searching}>
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
				searchResultsLabel={searchResultsLabel}
				relatedResultsLabel={relatedResultsLabel}
				searchResultsInBody={searchResultsInBody}
				refreshControl={refreshControl}
			>
				{/* One shell either way: the children's parent must not change when a
				    query starts, or everything under it — including the header's own
				    search field — remounts mid-keystroke. */}
				<FilterSheet {...filterConfig} hideChrome={searching}>
					{children}
				</FilterSheet>
			</MailListHeader>
		</FilterPanelProvider>
	);
}
