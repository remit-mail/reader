import { ChevronDown, Clock } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn.js";
import { type SearchResult, SearchResultRow } from "./search-result-row.js";

/** Rows shown before the "Show N more" expander kicks in. */
const SECTION_ROW_CAP = 6;

export interface SearchResultSection {
	id: string;
	label: string;
	results: SearchResult[];
	/** Seed the section-collapse state — lets a story render the header-only view. */
	initialCollapsed?: boolean;
}

export interface SearchResultsProps {
	/** The current query — narrows what's shown and bolds literal matches. */
	value: string;
	/** Recent searches shown when the query is empty. */
	recentSearches?: string[];
	onPickRecent?: (query: string) => void;
	/** Grouped result sections (e.g. "Top matches", "Related"). */
	sections?: SearchResultSection[];
	loading?: boolean;
	onSelectResult?: (id: string) => void;
}

/**
 * One result section: a sticky header that collapses the section to just its
 * label + count, and a "Show N more" control that reveals rows past the cap.
 * Mirrors `BriefSection`'s header rhythm so search and the brief stay in lockstep
 * without sharing data shapes. Always tappable — it never disables.
 */
function CollapsibleResultSection({
	section,
	query,
	onSelectResult,
}: {
	section: SearchResultSection;
	query?: string;
	onSelectResult?: (id: string) => void;
}) {
	const [collapsed, setCollapsed] = useState(section.initialCollapsed ?? false);
	const [expanded, setExpanded] = useState(false);

	const overCap = section.results.length > SECTION_ROW_CAP;
	const capped = !expanded && overCap;
	const visible = capped
		? section.results.slice(0, SECTION_ROW_CAP)
		: section.results;
	const hiddenCount = section.results.length - visible.length;

	return (
		<div>
			<button
				type="button"
				aria-expanded={!collapsed}
				onClick={() => setCollapsed((v) => !v)}
				className="sticky top-0 z-10 flex h-section-row w-full items-center gap-1.5 border-b border-line bg-surface-sunken px-row-inset text-left transition-colors hover:bg-surface"
			>
				<span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
					{section.label}
				</span>
				<span className="text-2xs text-fg-subtle tabular-nums">
					{section.results.length}
				</span>
				<ChevronDown
					className={cn(
						"size-3 shrink-0 text-fg-subtle transition-transform duration-200",
						collapsed ? "rotate-0" : "rotate-180",
					)}
				/>
			</button>
			{!collapsed && (
				<>
					{visible.map((result) => (
						<SearchResultRow
							key={result.id}
							result={result}
							query={query}
							onClick={
								onSelectResult ? () => onSelectResult(result.id) : undefined
							}
						/>
					))}
					{overCap && (
						<button
							type="button"
							onClick={() => setExpanded((v) => !v)}
							className="flex w-full items-center justify-center border-b border-line px-row-inset py-1.5 text-2xs font-medium text-accent transition-colors hover:bg-surface"
						>
							{expanded ? "Show less" : `Show ${hiddenCount} more`}
							{!expanded && <ChevronDown className="ml-1 size-3" />}
						</button>
					)}
				</>
			)}
		</div>
	);
}

/**
 * The sectioned search-results body shared by the phone `MobileSearchView`
 * takeover and the desktop/tablet list pane. It swaps between recent searches
 * (empty query), a loading skeleton, an empty state, and the collapsible result
 * sections — one implementation so both tiers render identical rows. The caller
 * owns the surrounding chrome and scroll container (a `FilterSheet`, the
 * takeover header, or the list-pane body). Presentational and prop-driven.
 */
export function SearchResults({
	value,
	recentSearches,
	onPickRecent,
	sections,
	loading,
	onSelectResult,
}: SearchResultsProps) {
	const hasQuery = value.trim().length > 0;
	const hasResults = (sections ?? []).some(
		(section) => section.results.length > 0,
	);

	if (!hasQuery) {
		if (recentSearches && recentSearches.length > 0) {
			return (
				<div className="flex flex-col">
					<h3 className="px-row-inset pb-1 pt-3 text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
						Recent searches
					</h3>
					{recentSearches.map((recent) => (
						<button
							key={recent}
							type="button"
							onClick={() => onPickRecent?.(recent)}
							className="flex w-full items-center gap-2.5 border-b border-line px-row-inset py-2.5 text-left transition-colors hover:bg-surface-sunken"
						>
							<Clock className="size-4 shrink-0 text-fg-subtle" />
							<span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
								{recent}
							</span>
						</button>
					))}
				</div>
			);
		}
		return (
			<p className="px-row-inset py-6 text-center text-sm text-fg-subtle">
				Search across your mail by sender, subject or words in the message.
			</p>
		);
	}

	if (loading) {
		return (
			<div className="flex flex-col gap-3 px-row-inset py-4">
				{[0, 1, 2, 3].map((row) => (
					<div key={row} className="flex flex-col gap-1.5">
						<div className="h-3 w-1/3 animate-pulse rounded bg-surface-sunken" />
						<div className="h-3 w-2/3 animate-pulse rounded bg-surface-sunken" />
						<div className="h-2.5 w-1/2 animate-pulse rounded bg-surface-sunken" />
					</div>
				))}
			</div>
		);
	}

	if (!hasResults) {
		return (
			<div className="px-row-inset py-10 text-center">
				<p className="text-sm font-medium text-fg">
					No matches for &ldquo;{value}&rdquo;
				</p>
				<p className="mt-1 text-xs text-fg-subtle">
					Try a different word, or adjust the filters above.
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			{sections
				?.filter((section) => section.results.length > 0)
				.map((section) => (
					<CollapsibleResultSection
						key={section.id}
						section={section}
						query={value}
						onSelectResult={onSelectResult}
					/>
				))}
		</div>
	);
}
