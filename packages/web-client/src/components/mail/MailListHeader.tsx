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
 * Results split into two sections, one per engine: literal/instant and semantic.
 * The consumer dedupes them — a thread in both appears only under the literal
 * section — and names them, so a view whose engines reach different mail says so
 * ("In Archive" / "Everywhere"). Each loads independently; an empty section
 * drops out kit-side, so a semantic-only result still shows when the literal
 * search finds nothing. The hamburger opens the nav drawer via the enclosing
 * `AppShellSlotted`.
 *
 * This is also the one place the route's scope reaches the results list, so both
 * tiers agree on it: a global search labels every row with the folder it came
 * from and offers the spam it held out, and a scoped search does neither. See
 * `resultsScopeForState` and `lib/spam-offer.ts`.
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
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { isSinglePaneTier, useLayoutTier } from "@/hooks/useLayoutTier";
import { useSearchScope } from "@/hooks/useSearchScope";
import { useSearchTokenContext } from "@/hooks/useSearchTokenContext";
import { useMailContext } from "@/lib/mail-context";
import { loadRecentSearches, saveRecentSearch } from "@/lib/recent-searches";
import { resultsScopeForState, routeMailboxId } from "@/lib/search-scope";
import {
	parseSearchTokens,
	removeSearchToken,
	searchTokenLabel,
} from "@/lib/search-tokens";
import { spamOfferForResults } from "@/lib/spam-offer";

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
	onSelectSearchResult?: (result: SearchResult) => void;
	/**
	 * Section headings. A view whose two engines cover different ground names
	 * them by that ground ("In Archive" / "Everywhere") so the reach of a result
	 * is on screen rather than inferred.
	 */
	searchResultsLabel?: string;
	relatedResultsLabel?: string;
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
	searchResultsLabel = "Top matches",
	relatedResultsLabel = "Related",
}: MailListHeaderProps) {
	const {
		accounts,
		resultFolderIndex,
		searchQuery,
		searchInput,
		onSearchChange,
		onSearchClear,
		searchViewKey,
	} = useMailContext();
	const tokenContext = useSearchTokenContext();
	const navigate = useNavigate();
	const layout = useAppShellLayout();
	const tier = useLayoutTier();
	const [searchOpen, setSearchOpen] = useState(false);
	const [recentSearches, setRecentSearches] = useState(loadRecentSearches);

	// Leaving the view ends the search: the shell drops the query, and the chrome
	// it opened — the phone takeover, the expanded tablet field — closes with it
	// rather than sitting there empty over the new mailbox (#47).
	const searchViewRef = useRef(searchViewKey);
	useEffect(() => {
		if (searchViewRef.current === searchViewKey) return;
		searchViewRef.current = searchViewKey;
		setSearchOpen(false);
	}, [searchViewKey]);

	const hasQuery = searchInput.trim().length > 0;
	// Filter tokens (`from:`, `has:attachment`, `account:`, …) parsed live from
	// the typed query render as removable chips above the sections; removing one
	// edits the query text directly, which re-parses on the next render. The
	// parse runs through `useSearchTokenContext`, the same one the engines use,
	// so a chip appears only for a term that is actually being applied — on a
	// scoped view `in:` is not resolved and so is never chipped here.
	const tokenChips = parseSearchTokens(searchInput, tokenContext).tokens.map(
		(token) => ({
			label: searchTokenLabel(token),
			onRemove: () => onSearchChange(removeSearchToken(searchInput, token)),
		}),
	);
	const topMatches = searchResults ?? [];
	const related = relatedResults ?? [];
	// Always offer both sections while a query is present; the kit drops the empty
	// ones, so a "Related"-only hit still shows and two empties fall to its empty
	// state. The empty-query case (recent searches) is the kit's job.
	const sections: SearchResultSection[] = hasQuery
		? [
				{ id: "top", label: searchResultsLabel, results: topMatches },
				{ id: "related", label: relatedResultsLabel, results: related },
			]
		: [];
	// Skeleton only while nothing is in yet — once either section has rows, show
	// them and let the other arrive (or not). Keeps the two sources independent.
	const hasAnyResult = topMatches.length + related.length > 0;
	const resultsLoading =
		!hasAnyResult && (searchLoading === true || relatedLoading === true);

	// The scope the results list acts on is the route's scope, mapped down to the
	// two states the list distinguishes; the mailbox's appointed role is what
	// lets a search scoped to Spam show its rows rather than drop them.
	const { scope } = useSearchScope(accounts);
	const matches = useRouterState({ select: (s) => s.matches });
	const scopedMailboxId = routeMailboxId(matches);
	const resultsScope = resultsScopeForState(
		scope,
		scopedMailboxId ? resultFolderIndex.get(scopedMailboxId)?.role : undefined,
	);

	// Spam is held out of a global search and offered instead. Only a global
	// search offers it: a scoped search shows its own scope and no more, so
	// neither the count nor the offer exists there.
	const spamOffer =
		resultsScope.kind === "global"
			? spamOfferForResults([...topMatches, ...related])
			: undefined;
	// The offer counts results for the *committed* query, so that is the query it
	// carries into Spam — taking the offer shows the matches it advertised, not
	// whatever has been typed since.
	const onScopeToSpam = spamOffer
		? () =>
				navigate({
					to: "/mail/$mailboxId",
					params: { mailboxId: spamOffer.mailboxId },
					search: {
						q: searchQuery || undefined,
						selectedMessageId: undefined,
						selectedThreadId: undefined,
					},
				})
		: undefined;
	const spamProps = {
		scope: resultsScope,
		...(spamOffer ? { spamMatchCount: spamOffer.count } : {}),
		...(onScopeToSpam ? { onScopeToSpam } : {}),
	};

	if (tier === "phone" && searchOpen) {
		const handleSelectResult = (result: SearchResult) => {
			setRecentSearches(saveRecentSearch(searchInput));
			setSearchOpen(false);
			onSelectSearchResult?.(result);
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
				tokens={tokenChips}
				{...spamProps}
			/>
		);
	}

	// Tablet + desktop keep the inline toolbar search; once a query is present the
	// list-pane body swaps to the same sectioned results the phone takeover shows,
	// under the same FilterSheet. Clearing the query restores the normal list.
	const showInlineResults = tier !== "phone" && hasQuery;
	const handleSelectInlineResult = (result: SearchResult) => {
		setRecentSearches(saveRecentSearch(searchInput));
		onSelectSearchResult?.(result);
	};
	const results = (
		<SearchResults
			value={searchInput}
			sections={sections}
			loading={resultsLoading}
			onSelectResult={handleSelectInlineResult}
			tokens={tokenChips}
			{...spamProps}
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
				// Desktop mounts the app top bar, which owns search for the whole
				// shell — the list header shows no field there, so the page never
				// has two search inputs competing for "/" and for focus. Below
				// desktop the header keeps a compact magnifier: on phone it opens
				// the full-screen takeover above, on tablet it expands over the
				// title. `isSinglePaneTier` is the same predicate the shell gates
				// the top bar on, so the two cannot drift into zero or two fields.
				isDesktop={false}
				showSearch={isSinglePaneTier(tier)}
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
