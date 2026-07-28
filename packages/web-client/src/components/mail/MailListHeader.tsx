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
 * `SearchResults` sections. Consumers feed the filter chrome and query-narrowed
 * results; both tiers render identical rows.
 *
 * The field offers what the search API can be told: token names for a bare word,
 * that token's values once its name is committed. The list sits under the field
 * on both tiers, in flow, so it takes its own space instead of covering the
 * query it completes.
 *
 * An active query owns the pane. The filter chrome is not rendered while one is
 * present — the two narrow the same list by the same intent and would sit in the
 * same place — and its place is taken by `MakeFilterAction`, which the pane mounts
 * itself so it is there for every search on every view, whichever body is showing
 * the results.
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
 * `resultsScopeForRoute` and `lib/spam-offer.ts`.
 */
import {
	type FilterSheetProps,
	isConvertible,
	MailHeader,
	MakeFilterAction,
	MobileSearchView,
	type SearchCaretRequest,
	type SearchFieldSuggest,
	type SearchResult,
	type SearchResultSection,
	SearchResults,
	type SearchScope,
	type Suggestion,
	SuggestList,
	useAppShellLayout,
	useSuggestList,
} from "@remit/ui";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { isSinglePaneTier, useLayoutTier } from "@/hooks/useLayoutTier";
import { useSearchScope } from "@/hooks/useSearchScope";
import { useSearchSuggestions } from "@/hooks/useSearchSuggestions";
import { useSearchTokenContext } from "@/hooks/useSearchTokenContext";
import { useMailContext } from "@/lib/mail-context";
import { convertSearchToRule } from "@/lib/organize/search-to-rule";
import { loadRecentSearches, saveRecentSearch } from "@/lib/recent-searches";
import { resultsScopeForRoute, routeMailboxId } from "@/lib/search-scope";
import { applySearchSuggestion } from "@/lib/search-suggestions";
import { showInlineSearchResults } from "@/lib/search-surface";
import {
	parseSearchTokens,
	removeSearchToken,
	searchTokenLabel,
} from "@/lib/search-tokens";
import { spamOfferForResults } from "@/lib/spam-offer";
import { SearchFilterDialog } from "./organize/SearchFilterDialog";

export interface MailListHeaderProps {
	title: string;
	unreadCount: number;
	/** The list body (filter sheet / sections / virtualized rows). */
	children: ReactNode;
	/**
	 * Replaces the header for as long as a selection is active — the same slot
	 * contract the kit `MessageListPane` gives the mailbox list, so every list
	 * puts its bulk-action bar in the same place.
	 */
	selectionBar?: ReactNode;
	/**
	 * Overlay anchored to the bottom of the pane (the mobile selection sheet).
	 * The pane is the positioned ancestor the sheet measures against.
	 */
	selectionSheet?: ReactNode;
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
	/**
	 * The body renders the committed search itself as a selectable list — the
	 * mailbox route's `MessageList` filters to the search results and hosts the
	 * multi-select toolbar and the "Select all N matching" escalation (#212).
	 * When set, a committed query keeps the body on tablet/desktop instead of
	 * swapping in the read-only two-engine `SearchResults` panel; the panel still
	 * shows while the query is being typed (uncommitted). Views whose body is not
	 * a search-result list (the brief, flagged, global search) leave this unset
	 * and keep the panel for every query.
	 */
	searchResultsInBody?: boolean;
}

export function MailListHeader({
	title,
	unreadCount,
	children,
	selectionBar,
	selectionSheet,
	footer,
	searchFilter,
	searchResults,
	searchLoading,
	relatedResults,
	relatedLoading,
	onSelectSearchResult,
	searchResultsLabel = "Top matches",
	relatedResultsLabel = "Related",
	searchResultsInBody = false,
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
	const [filterOpen, setFilterOpen] = useState(false);

	// Leaving the view ends the search: the shell drops the query, and the chrome
	// it opened — the phone takeover, the expanded tablet field — closes with it
	// rather than sitting there empty over the new mailbox (#47).
	const searchViewRef = useRef(searchViewKey);
	useEffect(() => {
		if (searchViewRef.current === searchViewKey) return;
		searchViewRef.current = searchViewKey;
		setSearchOpen(false);
	}, [searchViewKey]);

	// What the box offers for the term being typed. The field says where the
	// caret is; the caret decides whether the offer is a token name or one
	// token's values, and picking one replaces that term and leaves the caret
	// ready for the next. Typing always wins — the list only ever inserts, and a
	// term it has nothing for leaves the field the plain text box it is.
	//
	// An empty field belongs to the recent searches and the filter row, as it
	// does everywhere else in this pane, so the offer starts with the first
	// character typed. The caret on the whitespace after a finished token is a
	// term of its own, which is where the whole vocabulary is offered again.
	const [caretPosition, setCaretPosition] = useState(0);
	const [fieldFocused, setFieldFocused] = useState(false);
	const [caretRequest, setCaretRequest] = useState<
		SearchCaretRequest | undefined
	>(undefined);
	const suggestions = useSearchSuggestions({
		query: searchInput,
		cursor: caretPosition,
		enabled: fieldFocused && searchInput.trim().length > 0,
	});
	const applySuggestion = useCallback(
		(suggestion: Suggestion) => {
			const applied = applySearchSuggestion(
				searchInput,
				caretPosition,
				suggestion,
			);
			onSearchChange(applied.query);
			setCaretRequest({ cursor: applied.cursor });
		},
		[searchInput, caretPosition, onSearchChange],
	);
	const suggest = useSuggestList({
		count: suggestions.length,
		onAccept: (index) => {
			const suggestion = suggestions[index];
			if (suggestion) applySuggestion(suggestion);
		},
	});
	const searchSuggest: SearchFieldSuggest = {
		comboboxProps: suggest.comboboxProps,
		onKeyDown: suggest.handleKeyDown,
		onCaretChange: setCaretPosition,
		onFocusChange: setFieldFocused,
		...(caretRequest ? { caret: caretRequest } : {}),
	};
	// Under the field and in flow, on both tiers: a phone's soft keyboard owns
	// the lower half of the screen, and a list floating over the field would
	// cover the query it is completing.
	const suggestList = suggest.open ? (
		<SuggestList
			id={suggest.listId}
			suggestions={suggestions}
			activeIndex={suggest.activeIndex}
			optionId={suggest.optionId}
			onPick={applySuggestion}
			onHighlight={suggest.setActiveIndex}
			label="Search suggestions"
			className="mx-row-inset mt-1 shrink-0"
		/>
	) : null;

	const hasQuery = searchInput.trim().length > 0;
	// Filter tokens (`from:`, `has:attachment`, `account:`, …) parsed live from
	// the typed query render as removable chips above the sections; removing one
	// edits the query text directly, which re-parses on the next render. The
	// parse runs through `useSearchTokenContext`, the same one the engines use,
	// so a chip appears only for a term that is actually being applied — on a
	// scoped view `in:` is not resolved and so is never chipped here.
	// Memoized on the stable name indexes (not the fresh context object) so the
	// filter dialog receives a stable parse and does not re-run its seed preview
	// every render.
	const { mailboxesByName, accountsByName } = tokenContext;
	const parsed = useMemo(
		() => parseSearchTokens(searchInput, { mailboxesByName, accountsByName }),
		[searchInput, mailboxesByName, accountsByName],
	);
	const tokenChips = parsed.tokens.map((token) => ({
		label: searchTokenLabel(token),
		onRemove: () => onSearchChange(removeSearchToken(searchInput, token)),
	}));
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

	// The mailbox's appointed role is what lets a search scoped to Spam show its
	// rows rather than drop them.
	const { scope } = useSearchScope(accounts);
	const matches = useRouterState({ select: (s) => s.matches });
	const scopedMailboxId = routeMailboxId(matches);
	const routeScope = resultsScopeForRoute(
		matches,
		scope,
		scopedMailboxId ? resultFolderIndex.get(scopedMailboxId)?.role : undefined,
	);

	// The offer counts results for the *committed* query, so that is the query it
	// carries into Spam. The count the banner states is the results list's own,
	// over every row it held out; the app supplies only where "Go to Spam" goes.
	const spamOffer =
		routeScope.kind === "global"
			? spamOfferForResults([...topMatches, ...related])
			: undefined;
	const resultsScope: SearchScope = spamOffer
		? {
				kind: "global",
				onScopeToSpam: () =>
					navigate({
						to: "/mail/$mailboxId",
						params: { mailboxId: spamOffer.mailboxId },
						search: {
							q: searchQuery || undefined,
							selectedMessageId: undefined,
							selectedThreadId: undefined,
						},
					}),
			}
		: routeScope;

	// Make-this-a-filter (RFC 038 D5): convert the current search to a pre-filled
	// rule and open the shared chip editor. The filter is created for the account
	// an `account:` facet names, else the primary account. The literal filter
	// cannot reproduce the search's semantic reach, so the conversion states it
	// whenever the search surfaced a "Related" section — a direct signal, read
	// here from the semantic results, never a capability probe. Disabled with a
	// reason when the search has no clause to filter on (only non-clause facets,
	// or a bare folder scope).
	//
	// It belongs to the search, not to any one way of showing it. The affordance
	// therefore sits in the pane, above whichever body is up — the read-only
	// results panel, or a list whose own rows narrow to the committed query — and
	// is mounted on the same condition as the query itself. Rendering it inside the
	// results panel made it a mailbox's flash: the panel shows while the query is
	// being typed and hands back to `MessageList` the moment the query commits to
	// the URL, taking the affordance down with it a few hundred milliseconds after
	// it appeared, and leaving the brief (which keeps the panel for any query) as
	// the only place it survived.
	const accountToken = parsed.tokens.find((token) => token.type === "account");
	const targetAccountId = accountToken?.accountId ?? accounts[0]?.accountId;
	const searchHadSemanticReach = related.length > 0;
	const makeFilter =
		hasQuery && targetAccountId
			? {
					onClick: () => setFilterOpen(true),
					disabledReason: isConvertible(
						convertSearchToRule(parsed, { searchHadSemanticReach }),
					)
						? undefined
						: "Add a sender or words to filter on",
				}
			: undefined;
	// A selection replaces the header with its bulk-action bar and owns the pane;
	// the search affordance stands down until the selection clears.
	const makeFilterAction =
		makeFilter && !selectionBar ? <MakeFilterAction {...makeFilter} /> : null;
	const filterDialog =
		filterOpen && targetAccountId ? (
			<SearchFilterDialog
				open={filterOpen}
				accountId={targetAccountId}
				parsed={parsed}
				searchHadSemanticReach={searchHadSemanticReach}
				onClose={() => setFilterOpen(false)}
			/>
		) : null;

	if (tier === "phone" && searchOpen) {
		const handleSelectResult = (result: SearchResult) => {
			setRecentSearches(saveRecentSearch(searchInput));
			setSearchOpen(false);
			onSelectSearchResult?.(result);
		};
		return (
			<>
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
					makeFilter={makeFilter}
					sections={sections}
					loading={resultsLoading}
					onSelectResult={handleSelectResult}
					tokens={tokenChips}
					scope={resultsScope}
					suggest={searchSuggest}
					suggestList={suggestList}
				/>
				{filterDialog}
			</>
		);
	}

	// Tablet + desktop keep the inline toolbar search; while a query is being
	// typed the list-pane body swaps to the same sectioned results the phone
	// takeover shows, under the same FilterSheet. A view whose own body renders
	// the committed search as a selectable list (`searchResultsInBody`, the
	// mailbox route) keeps the panel only until the query commits to the URL,
	// then hands back to its `MessageList` so the multi-select toolbar and the
	// escalation are reachable (#212). Clearing the query restores the normal list.
	const showInlineResults = showInlineSearchResults({
		tier,
		hasLiveInput: hasQuery,
		hasCommittedQuery: searchQuery.trim().length > 0,
		bodyRendersCommittedResults: searchResultsInBody,
	});
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
			scope={resultsScope}
		/>
	);
	// The filter chrome is not rendered while a query is active — see `makeFilter`
	// above — so the results panel gets the plain scroll container either way.
	const body = showInlineResults ? (
		<div className="h-full overflow-y-auto">{results}</div>
	) : (
		children
	);

	return (
		<section className="relative flex h-full w-full flex-col bg-surface">
			{selectionBar ?? (
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
					searchSuggest={searchSuggest}
				/>
			)}
			{suggestList}
			{makeFilterAction}
			<div className="min-h-0 flex-1">{body}</div>
			{footer}
			{filterDialog}
			{selectionSheet}
		</section>
	);
}
