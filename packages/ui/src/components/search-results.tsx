import { ChevronDown, Clock } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn.js";
import type { FolderRole } from "./folder-role.js";
import { type SearchResult, SearchResultRow } from "./search-result-row.js";
import { SearchTokenChips } from "./search-token-chip.js";
import { SpamResultsOffer } from "./spam-results-offer.js";

/** Rows shown before the "Show N more" expander kicks in. */
const SECTION_ROW_CAP = 6;

export interface SearchResultSection {
	id: string;
	label: string;
	results: SearchResult[];
	/** Seed the section-collapse state — lets a story render the header-only view. */
	initialCollapsed?: boolean;
}

/**
 * What the search currently covers.
 *
 * - `global` — the unscoped search the daily brief runs: every account, every
 *   folder, no chip in the bar. It is the only scope that holds spam out, so it
 *   is the only one that carries a way back to it: without `onScopeToSpam` there
 *   is nowhere to send the user and no offer is made.
 * - `folder` — narrowed to one place by the sidebar, which the bar shows as a
 *   chip.
 * - `collection` — narrowed by something that is not a folder, `is:starred`
 *   being the one that exists. It still spans folders, so rows carry their
 *   provenance; and because the narrowing is the user's own (they starred the
 *   mail), spam is not held back from them.
 */
export type SearchScope =
	| { kind: "global"; onScopeToSpam?: () => void }
	| { kind: "collection" }
	| { kind: "folder"; role?: FolderRole };

const GLOBAL_SCOPE: SearchScope = { kind: "global" };

const isSpamScope = (scope: SearchScope): boolean =>
	scope.kind === "folder" && scope.role === "junk";

const isSpamResult = (result: SearchResult): boolean =>
	result.folder?.role === "junk";

/**
 * Split spam matches out of the rows a search returned.
 *
 * Spam is identified by the account's `\Junk` special-use appointment, never by
 * folder name, so an account that calls it `Junk`, `Bulk Mail` or nothing at
 * all behaves the same, and an account with no junk folder simply never yields
 * a spam row.
 */
export function partitionSpamResults(results: SearchResult[]): {
	kept: SearchResult[];
	spam: SearchResult[];
} {
	const kept: SearchResult[] = [];
	const spam: SearchResult[] = [];
	for (const result of results) {
		if (isSpamResult(result)) spam.push(result);
		else kept.push(result);
	}
	return { kept, spam };
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
	onSelectResult?: (result: SearchResult) => void;
	/**
	 * Active filter-token chips parsed from the query (`from:`, `has:attachment`,
	 * …), removable. Rendered above the results/loading/empty states so they stay
	 * visible whatever the query returns; omit or pass an empty array when the
	 * query has no recognized tokens.
	 */
	tokens?: { label: string; onRemove: () => void }[];
	/** What the search covers. Defaults to the unscoped, global search. */
	scope?: SearchScope;
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
	showFolder,
}: {
	section: SearchResultSection;
	query?: string;
	onSelectResult?: (result: SearchResult) => void;
	showFolder?: boolean;
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
							showFolder={showFolder}
							onClick={
								onSelectResult ? () => onSelectResult(result) : undefined
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
 *
 * Spam is the one folder that does not inline, and it behaves differently by
 * scope:
 *
 * - **Global** — spam rows are held out of the sections and offered instead, as
 *   a count with a way into a Spam-scoped search.
 * - **Scoped to a folder** — spam rows are held out and nothing is offered. A
 *   scoped search shows its own scope and no more.
 * - **Scoped to Spam** — ordinary rows, rendered normally, no offer.
 * - **A collection** (`is:starred`) — ordinary rows, spam included. The user
 *   picked this mail out by hand; there is nothing to protect them from.
 *
 * Provenance labels follow whether the search reaches more than one folder: a
 * global or collection search names the folder each row came from, a
 * folder-scoped one would only repeat its own chip.
 */
export function SearchResults({
	value,
	recentSearches,
	onPickRecent,
	sections,
	loading,
	onSelectResult,
	tokens,
	scope = GLOBAL_SCOPE,
}: SearchResultsProps) {
	const hasQuery = value.trim().length > 0;

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

	const chips = tokens && tokens.length > 0 && (
		<SearchTokenChips tokens={tokens} />
	);

	if (loading) {
		return (
			<div className="flex flex-col">
				{chips}
				<div className="flex flex-col gap-3 px-row-inset py-4">
					{[0, 1, 2, 3].map((row) => (
						<div key={row} className="flex flex-col gap-1.5">
							<div className="h-3 w-1/3 animate-pulse rounded bg-surface-sunken" />
							<div className="h-3 w-2/3 animate-pulse rounded bg-surface-sunken" />
							<div className="h-2.5 w-1/2 animate-pulse rounded bg-surface-sunken" />
						</div>
					))}
				</div>
			</div>
		);
	}

	const isGlobal = scope.kind === "global";
	// Only a folder search holds spam back. Scoped to Spam there is nothing to
	// hold back, and a collection is the user's own selection of mail rather than
	// a place, so a starred spam message stays where the user put it.
	const spamInline = isSpamScope(scope) || scope.kind === "collection";
	// A search that reaches more than one folder names the folder each row came
	// from; one confined to a single folder would repeat its own chip.
	const spansFolders = isGlobal || scope.kind === "collection";

	const partitioned = (sections ?? []).map((section) => {
		if (spamInline) return { section, spam: [] as SearchResult[] };
		const { kept, spam } = partitionSpamResults(section.results);
		return { section: { ...section, results: kept }, spam };
	});

	const visibleSections = partitioned.map((entry) => entry.section);
	const heldOutSpamCount = partitioned.reduce(
		(total, entry) => total + entry.spam.length,
		0,
	);
	const spamOffer =
		scope.kind === "global" &&
		heldOutSpamCount > 0 &&
		scope.onScopeToSpam !== undefined ? (
			<SpamResultsOffer
				count={heldOutSpamCount}
				onScopeToSpam={scope.onScopeToSpam}
			/>
		) : undefined;

	const hasResults = visibleSections.some(
		(section) => section.results.length > 0,
	);

	if (!hasResults) {
		return (
			<div className="flex flex-col">
				{chips}
				{spamOffer}
				<div className="px-row-inset py-10 text-center">
					<p className="text-sm font-medium text-fg">
						No matches for &ldquo;{value}&rdquo;
					</p>
					<p className="mt-1 text-xs text-fg-subtle">
						Try a different word, or adjust the filters above.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			{chips}
			{spamOffer}
			{visibleSections
				.filter((section) => section.results.length > 0)
				.map((section) => (
					<CollapsibleResultSection
						key={section.id}
						section={section}
						query={value}
						showFolder={spansFolders}
						onSelectResult={onSelectResult}
					/>
				))}
		</div>
	);
}
