/**
 * MailShell — the shell the live `/mail` route mounts, wired to fixtures.
 *
 * The app composes `AppShellSlotted` itself: it fills the nav, top-bar, list,
 * reading and intelligence slots with its own components rather than handing
 * data to the kit's `AppShell`. Anything that renders those slots differently is
 * a design that does not exist, so this file mirrors the route's own wiring:
 *
 * - the top bar is the kit's `ShellTopBar`, the same component the route
 *   mounts: desktop-only, spanning the whole layout, carrying the one search
 *   field, the nav toggle and the global actions;
 * - the list pane's header is a `SelectionTopBar`, up for every state of the
 *   list: it names the view and carries the nav button, the unread count, the
 *   filter caret and — only where the top bar is absent, so the page never has
 *   two — the search field, and from the first ticked row it carries the count
 *   and the verbs instead;
 * - the selection itself lives here, above the kit, the way it lives above it
 *   in the app;
 * - a query swaps the list body for the same `SearchResults` sections the phone
 *   takeover renders, takes the filter sheet down, and puts "Make this a filter"
 *   in the pane above whichever body is showing;
 * - completions for the term being typed sit under the field on both surfaces,
 *   in flow, so the list never covers the query it completes;
 * - below 1024px the shell is one pane: the nav is a slide-over, compose is the
 *   FAB, and the phone's magnifier opens the full-screen `MobileSearchView`;
 * - a view with a pane of its own — Drafts, the Outbox, compose — hands it in
 *   whole through the `list`, `reading` and `overlay` slots, the way the route
 *   hands `AppShellSlotted` its own panes. Every flow story mounts this shell,
 *   so the chrome around a screen under review is the chrome it ships with.
 *
 * See `packages/web-client/src/routes/mail.tsx`, `MailTopBar`, `MailListHeader`
 * and `MailViewChrome` for the originals.
 */
import {
	AppShellSlotted,
	type AppShellSlottedProps,
	Avatar,
	type BriefCategoryFilter,
	type BriefFilterSurface,
	Button,
	briefChipFilters,
	briefFilterConfig,
	briefFilterHasTerm,
	briefQueryCategory,
	briefQueryIsActive,
	clearBriefFiltersInQuery,
	FilterPanelProvider,
	type FilterPreset,
	FilterSheet,
	type FilterSheetProps,
	FilterToggle,
	type IntelligenceCalendarSurface,
	type IntelligenceData,
	IntelligencePanel,
	type IntelligenceTabId,
	isBriefCategory,
	isBriefFilterId,
	type ListState,
	MakeFilterAction,
	MessageListPane,
	MobileSearchView,
	NavSidebar,
	ReadingPane,
	RefreshButton,
	SearchBar,
	type SearchCaretRequest,
	type SearchChip,
	type SearchFieldSuggest,
	type SearchResultSection,
	SearchResults,
	type SearchScope,
	ShellTopBar,
	type Suggestion,
	SuggestList,
	setBriefCategoryInQuery,
	type ThreadData,
	type ThreadRowData,
	type ThreadSection,
	toggleBriefFilterInQuery,
	useSuggestList,
	type Verb,
} from "@remit/ui";
import { Pencil, Search, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	briefSources,
	mutedAccountCount,
	navAccounts,
} from "../fixtures/workspace.js";
import { ListSelectionBar, useListTriage } from "../lib/list-selection.js";

/** The width at which the reading pane, the nav column and the top bar appear. */
const DESKTOP_MIN_WIDTH = 1024;

export interface MailShellProps {
	/**
	 * Width the shell is framed at. Below 1024 the story gets the app's
	 * single-pane arrangement — the route makes the same call from its own
	 * layout tier.
	 */
	width?: number;
	selectedNavId?: string;
	listTitle?: string;
	/**
	 * Unread count beside the list title. `null` is the state a server count the
	 * view could not obtain renders as: no number at all, never a figure derived
	 * from the rows that happen to be loaded (#308).
	 */
	unreadCount?: number | null;
	sections?: ThreadSection[];
	/** Seeds the brief's category scope; the shell owns it from there. */
	briefCategory?: BriefCategoryFilter;
	/**
	 * Seeds the account pill the brief is segmented by, `"all"` being the
	 * aggregate. The shell owns it from there.
	 */
	briefSource?: string;
	/** Rows ticked on mount, for a story whose subject is a selection. */
	selectedIds?: string[];
	/** Opens the panel the caret opens, for a story whose subject is what is in it. */
	filterOpen?: boolean;
	/**
	 * What a verb on the list's selection bar does, given the rows ticked when it
	 * is pressed. Absent, the bar's own delete and mark-read act on the list.
	 */
	onVerb?: (verb: Verb, selected: ReadonlySet<string>) => void;
	/**
	 * Offers "Make this a filter" in the pane for a view that is already a page
	 * of results. An active query offers it on its own.
	 */
	onMakeFilter?: () => void;
	/** The list where it has no rows: empty, loading, error. */
	listState?: ListState;
	/**
	 * Replaces the list pane whole — a view that brings its own header and body,
	 * the way Drafts and the Outbox do in the app.
	 */
	list?: ReactNode;
	/** Replaces the reading pane, which compose takes over on desktop. */
	reading?: ReactNode;
	/**
	 * The top bar's Compose button, so a story can drive the step the app drives:
	 * compose takes the reading pane whatever was in it.
	 */
	onCompose?: () => void;
	/**
	 * Rendered over the shell: the compose sheet, a dialog, the selection wizard.
	 * Takes the place of the single-pane compose FAB.
	 */
	overlay?: ReactNode;
	/** Brief mode: collapsible sections that own their filter row. */
	briefFilters?: boolean;
	/** Plain mailbox: one flat list with the filter sheet slotted above it. */
	preset?: FilterPreset;
	thread?: ThreadData;
	/** The list row the open thread belongs to. */
	selectedThreadId?: string;
	/** Opens a row, so a story can drive the list-to-reading-pane step live. */
	onSelectThread?: (id: string) => void;
	/**
	 * A committed query leaves the body to the view's own rows instead of the
	 * read-only results panel — what the brief does, so its rows stay selectable
	 * and openable under a search (`MailListHeader`'s prop of the same name).
	 */
	searchResultsInBody?: boolean;
	intelligence?: IntelligenceData;
	/** The panel's calendar half. Without it the panel shows no tab strip. */
	calendar?: IntelligenceCalendarSurface;
	/** Which half of the panel a story opens on. */
	intelligenceTab?: IntelligenceTabId;
	intelligenceOpen?: boolean;
	isLoading?: boolean;
	/** The scope the route carries into the field, e.g. `in:spam`. */
	scopeChip?: SearchChip;
	/** Seeds the search field; a non-empty query swaps the list body for results. */
	query?: string;
	/**
	 * The query has settled — in the app, mirrored into the URL. The brief takes
	 * its own rows back at that point and keeps its filter panel, so the chips it
	 * composes into the query are reachable while the search is on.
	 */
	searchCommitted?: boolean;
	searchSections?: SearchResultSection[];
	searchLoading?: boolean;
	searchScope?: SearchScope;
	/** Filter tokens parsed out of the query, shown above the results. */
	searchTokens?: string[];
	/**
	 * Renders "Make this a filter" inert and states why — a query of only
	 * non-clause facets has nothing to convert. The affordance itself is offered
	 * for every active query, as the route does.
	 */
	makeFilterBlockedReason?: string;
	recentSearches?: string[];
	savedSearches?: string[];
	/**
	 * Completions offered for the term being typed. The app derives these from
	 * the caret and the search vocabulary; a story states the offer directly.
	 */
	searchSuggestions?: Suggestion[];
	/**
	 * Leaves the reading pane out entirely rather than falling back to the mail
	 * one. A view whose second pane is only sometimes there — the calendar with
	 * nothing open — needs the list to have the whole width until it is.
	 */
	readingPane?: "default" | "off";
	/**
	 * Which pane the two-pane split favours. Mail leaves it balanced; a list pane
	 * that is itself the work — the calendar grid — asks for the width.
	 */
	listBias?: AppShellSlottedProps["listBias"];
	/**
	 * Offers the calendar destination in the nav. The prototype turns it on; the
	 * mail flows leave it off, so their nav is the nav that ships today.
	 */
	calendarNav?: "hidden" | "shown";
	/** Phone: open the full-screen search takeover instead of the list. */
	searchOpen?: boolean;
	/** Nav slide-over open (narrow widths). */
	navOpen?: boolean;
}

interface SearchState {
	query: string;
	setQuery: (value: string) => void;
	chips?: SearchChip[];
	removeChip: () => void;
	sections: SearchResultSection[];
	loading?: boolean;
	scope?: SearchScope;
	tokens: { label: string; onRemove: () => void }[];
	recentSearches?: string[];
	/** "Make this a filter" — the pane offers it for every active query. */
	makeFilter?: { onClick: () => void; blockedReason?: string };
	suggestions?: Suggestion[];
}

/**
 * Replace the term the caret sits in with a completion, leaving the caret after
 * it. The app does this over the parsed search vocabulary
 * (`lib/search-suggestions.ts`); the shell keeps the same shape on plain words,
 * which is all a story needs to show what picking one does.
 */
function applyTermAtCaret(query: string, cursor: number, value: string) {
	const start = query.slice(0, cursor).search(/\S*$/);
	const end = cursor + (query.slice(cursor).match(/^\S*/)?.[0].length ?? 0);
	const insert = value.endsWith(":") ? value : `${value} `;
	return {
		query: query.slice(0, start) + insert + query.slice(end),
		cursor: start + insert.length,
	};
}

/**
 * The suggestion wiring both search surfaces share: the field reports its caret
 * and hands the list the keys it uses, and the list renders under the field
 * rather than over it. Mirrors `MailListHeader`.
 */
function useShellSuggest(search: SearchState) {
	const [cursor, setCursor] = useState(search.query.length);
	const [caret, setCaret] = useState<SearchCaretRequest | undefined>(undefined);
	const suggestions = search.suggestions ?? [];

	const apply = (suggestion: Suggestion) => {
		const applied = applyTermAtCaret(search.query, cursor, suggestion.value);
		search.setQuery(applied.query);
		setCaret({ cursor: applied.cursor });
	};

	const suggest = useSuggestList({
		count: suggestions.length,
		onAccept: (index) => {
			const suggestion = suggestions[index];
			if (suggestion) apply(suggestion);
		},
	});

	const field: SearchFieldSuggest = {
		comboboxProps: suggest.comboboxProps,
		onKeyDown: suggest.handleKeyDown,
		onCaretChange: setCursor,
		...(caret ? { caret } : {}),
	};

	const list = suggest.open ? (
		<SuggestList
			id={suggest.listId}
			suggestions={suggestions}
			activeIndex={suggest.activeIndex}
			optionId={suggest.optionId}
			onPick={apply}
			onHighlight={suggest.setActiveIndex}
			label="Search suggestions"
			className="mx-row-inset mt-1 shrink-0"
		/>
	) : null;

	return { field, list };
}

function TopBar({
	search,
	onCompose,
}: {
	search: SearchState;
	onCompose?: () => void;
}) {
	return (
		<ShellTopBar
			search={{
				value: search.query,
				scope: search.chips?.length ? "scoped" : "global",
				chips: search.chips,
				onChange: search.setQuery,
				onClear: () => search.setQuery(""),
				onClearQuery: () => search.setQuery(""),
				onRemoveChip: search.removeChip,
			}}
			onCompose={onCompose ?? (() => undefined)}
			onReportBug={() => undefined}
			onOpenSettings={() => undefined}
			composeShortcut="c"
			refreshControl={
				<RefreshButton
					state="idle"
					label="Refresh all accounts"
					onRefresh={() => undefined}
				/>
			}
			account={
				<button type="button" aria-label="Account">
					<Avatar name="Matthijs" email="matthijs@example.com" size="sm" />
				</button>
			}
		/>
	);
}

/** The FAB is the single-pane compose entry point; above it the top bar owns it. */
function ComposeFab() {
	return (
		<button
			type="button"
			aria-label="Compose new message"
			className="absolute bottom-4 right-4 z-30 flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg"
		>
			<Pencil className="size-6" />
		</button>
	);
}

function ListPane({
	title,
	unreadCount,
	sections,
	briefFilters,
	briefCategory,
	briefSource,
	filterOpen,
	listState,
	selectedIds,
	onVerb,
	preset,
	selectedThreadId,
	onSelectThread,
	searchResultsInBody,
	singlePane,
	isPhone,
	search,
	searchOpen,
	searchCommitted,
	onSearchOpenChange,
}: {
	title: string;
	unreadCount: number | null;
	sections: ThreadSection[];
	briefFilters?: boolean;
	briefCategory?: BriefCategoryFilter;
	briefSource?: string;
	filterOpen?: boolean;
	listState?: ListState;
	selectedIds?: string[];
	onVerb?: (verb: Verb, selected: ReadonlySet<string>) => void;
	preset?: FilterPreset;
	selectedThreadId?: string;
	onSelectThread?: (id: string) => void;
	searchResultsInBody?: boolean;
	singlePane: boolean;
	isPhone: boolean;
	search: SearchState;
	searchOpen: boolean;
	searchCommitted?: boolean;
	onSearchOpenChange: (open: boolean) => void;
}) {
	const suggest = useShellSuggest(search);
	// The filter, and whether its panel is up, held above both surfaces that
	// narrow the view: the panel the caret opens over the rows, and the phone
	// search takeover that replaces it. Anything living below goes with the
	// surface that unmounts.
	const [category, setCategory] = useState<string>(briefCategory ?? "all");
	const [filters, setFilters] = useState<ReadonlySet<string>>(new Set());
	const [source, setSource] = useState(briefSource ?? "all");
	const [expanded, setExpanded] = useState(filterOpen ?? false);

	const toggleOwnFilter = (id: string) =>
		setFilters((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	const clearOwnFilters = () => {
		setCategory("all");
		setFilters(new Set());
		setSource("all");
	};

	// The brief's chips are terms of the query while one is active: ticking one
	// writes `is:unread` or `category:newsletter` into the field, deleting the
	// term unticks the chip, and the two chips the vocabulary cannot spell —
	// "From contacts", "Today" — keep answering to the panel's own set. The kit
	// owns that composition, so the app and this prototype narrow the same rows
	// by the same rule.
	const composing = Boolean(briefFilters) && briefQueryIsActive(search.query);
	const ownBriefFilters = new Set([...filters].filter(isBriefFilterId));
	const shownFilters: ReadonlySet<string> = briefFilters
		? briefChipFilters({ query: search.query, ownFilters: ownBriefFilters })
		: filters;
	const shownCategory = composing ? briefQueryCategory(search.query) : category;

	const toggleFilter = (id: string) => {
		if (!composing || !isBriefFilterId(id) || !briefFilterHasTerm(id)) {
			toggleOwnFilter(id);
			return;
		}
		const next = toggleBriefFilterInQuery(search.query, id);
		if (next !== undefined) search.setQuery(next);
	};
	const selectCategory = (id: string) => {
		if (!composing || !isBriefCategory(id)) {
			setCategory(id);
			return;
		}
		search.setQuery(setBriefCategoryInQuery(search.query, id));
	};
	const clearFilters = () => {
		clearOwnFilters();
		if (composing) search.setQuery(clearBriefFiltersInQuery(search.query));
	};

	// The brief spans every account, so the accounts are a dimension it always
	// has: it brings its own preset rather than taking one from the story.
	const activePreset = briefFilters
		? briefFilterConfig(briefSources(source))
		: preset;
	const filterConfig: Omit<FilterSheetProps, "children"> | undefined =
		activePreset && {
			categories: activePreset.categories,
			filters: activePreset.filters,
			sources: activePreset.sources,
			sourcesNote:
				briefFilters && mutedAccountCount > 0
					? `+${mutedAccountCount} muted`
					: undefined,
			selectedCategory: shownCategory,
			activeFilters: shownFilters,
			expanded,
			onExpandedChange: setExpanded,
			onSelectCategory: selectCategory,
			onSelectSource: setSource,
			onToggleFilter: toggleFilter,
			onClear: clearFilters,
		};

	// The brief's own list applies the category and the chips over the vocabulary
	// it defines; the sheet speaks plain ids, so what is shared is narrowed to
	// that vocabulary here rather than asserted into it.
	const briefFilter: BriefFilterSurface | undefined = briefFilters
		? {
				briefCategory: isBriefCategory(shownCategory) ? shownCategory : "all",
				onSelectBriefCategory: selectCategory,
				sources: filterConfig?.sources,
				sourcesNote: filterConfig?.sourcesNote,
				onSelectSource: setSource,
				activeFilters: new Set([...shownFilters].filter(isBriefFilterId)),
				onToggleFilter: toggleFilter,
				onClearFilters: clearFilters,
			}
		: undefined;

	const hasQuery = search.query.trim().length > 0;
	// A settled query hands the brief its own rows back, so the caret stays up
	// and the chips it composes into the query are reachable there. The two-engine
	// results panel owns the pane only while a first query is still being typed.
	const briefRendersQuery = Boolean(
		briefFilters && hasQuery && searchCommitted,
	);
	const freeText = briefRendersQuery
		? clearBriefFiltersInQuery(search.query).trim().toLowerCase()
		: "";
	const narrows = source !== "all" || freeText.length > 0;
	const keeps = (thread: ThreadRowData): boolean =>
		(source === "all" || thread.accountId === source) &&
		(freeText.length === 0 ||
			thread.subject.toLowerCase().includes(freeText) ||
			thread.fromName.toLowerCase().includes(freeText));

	const scoped = narrows
		? sections
				.map((section) => ({
					...section,
					threads: section.threads.filter(keeps),
				}))
				.filter((section) => section.threads.length > 0)
		: sections;
	const triage = useListTriage(scoped, {
		initialSelectedIds: selectedIds,
		initialFocusedId: selectedThreadId,
		isDesktop: !singlePane,
	});

	const searchExpanded = singlePane && (searchOpen || hasQuery);

	if (isPhone && searchOpen) {
		return (
			<MobileSearchView
				value={search.query}
				onChange={search.setQuery}
				onClear={() => search.setQuery("")}
				onCancel={() => {
					search.setQuery("");
					onSearchOpenChange(false);
				}}
				filter={filterConfig}
				recentSearches={search.recentSearches}
				onPickRecent={search.setQuery}
				sections={hasQuery ? search.sections : []}
				loading={search.loading}
				tokens={search.tokens}
				chips={search.chips}
				onRemoveChip={search.removeChip}
				scope={search.scope}
				makeFilter={search.makeFilter}
				suggest={suggest.field}
				suggestList={suggest.list}
			/>
		);
	}

	const rows = (
		<MessageListPane
			hideHeader
			listTitle={title}
			sections={triage.sections}
			briefFilters={briefFilters}
			briefFilter={briefFilter}
			listState={listState}
			listScopeLabel={title}
			flatList={!briefFilters}
			selectedThreadId={selectedThreadId}
			onSelectThread={onSelectThread}
			isDesktop={!singlePane}
			selection={triage.paneSelection}
			keyboard={triage.paneKeyboard}
		/>
	);
	const results = (
		<SearchResults
			value={search.query}
			sections={search.sections}
			loading={search.loading}
			tokens={search.tokens}
			scope={search.scope}
		/>
	);
	// A view whose own body renders the committed search as a selectable list
	// (`searchResultsInBody`) keeps its rows in the pane instead of losing them
	// to the read-only results panel. The brief's chips compose into that same
	// query, so the caret over its rows needs to survive a search exactly where
	// the rows do — the sheet stands down only when the results panel has taken
	// the pane over.
	const bodyIsRows = !hasQuery || Boolean(searchResultsInBody);
	const inner: ReactNode = bodyIsRows ? rows : results;
	const briefOwnsSheet = Boolean(briefFilters) && bodyIsRows;
	const sheet = bodyIsRows && !briefOwnsSheet ? filterConfig : undefined;
	const body = sheet ? (
		<FilterSheet {...sheet}>{inner}</FilterSheet>
	) : (
		<div className="h-full overflow-y-auto">{inner}</div>
	);

	return (
		<FilterPanelProvider
			hasSheet={sheet !== undefined || briefOwnsSheet}
			open={expanded}
			onOpenChange={setExpanded}
		>
			<section className="flex h-full w-full flex-col bg-surface">
				<ListSelectionBar
					triage={triage}
					onVerb={onVerb}
					title={title}
					titleMeta={
						<>
							{unreadCount === null ? null : (
								<span className="shrink-0 text-2xs text-fg-subtle">
									{unreadCount.toLocaleString()} unread
								</span>
							)}
							<FilterToggle />
							<RefreshButton
								state="idle"
								label={
									briefFilters ? "Refresh daily brief" : `Refresh ${title}`
								}
								onRefresh={() => undefined}
							/>
						</>
					}
					searchSlot={
						singlePane &&
						!searchExpanded && (
							<Button
								variant="ghost"
								size="touch"
								icon={<Search className="size-5" />}
								onClick={() => onSearchOpenChange(true)}
								aria-label="Search"
								className="shrink-0"
							/>
						)
					}
					searchField={
						searchExpanded && (
							<>
								<div className="min-w-0 flex-1">
									<SearchBar
										value={search.query}
										onChange={search.setQuery}
										onClear={() => search.setQuery("")}
										globalFocusKey={false}
										showClearButton={false}
										suggest={suggest.field}
									/>
								</div>
								<Button
									variant="ghost"
									size="touch"
									icon={<X className="size-5" />}
									onClick={() => {
										search.setQuery("");
										onSearchOpenChange(false);
									}}
									aria-label="Close search"
									className="shrink-0"
								/>
								<FilterToggle />
							</>
						)
					}
					idleSlot={
						search.makeFilter && <MakeFilterAction {...search.makeFilter} />
					}
				/>
				{suggest.list}
				<div className="min-h-0 flex-1">{body}</div>
			</section>
		</FilterPanelProvider>
	);
}

export function MailShell({
	width = 1440,
	selectedNavId = "brief",
	listTitle = "Daily brief",
	unreadCount = 12,
	sections = [],
	briefFilters,
	briefCategory,
	briefSource,
	filterOpen,
	selectedIds,
	onVerb,
	onMakeFilter,
	listState,
	list: listOverride,
	reading,
	onCompose,
	overlay,
	preset,
	thread,
	selectedThreadId,
	onSelectThread,
	searchResultsInBody,
	intelligence,
	calendar,
	intelligenceTab,
	intelligenceOpen = true,
	isLoading,
	scopeChip,
	query = "",
	searchCommitted = false,
	searchSections = [],
	searchLoading,
	searchScope,
	searchTokens = [],
	makeFilterBlockedReason,
	recentSearches,
	savedSearches = [],
	searchSuggestions,
	readingPane = "default",
	listBias,
	calendarNav = "hidden",
	searchOpen: searchOpenSeed = false,
	navOpen: navOpenSeed = false,
}: MailShellProps) {
	const singlePane = width < DESKTOP_MIN_WIDTH;
	const isPhone = width < 768;
	const [searchQuery, setSearchQuery] = useState(query);
	const [chip, setChip] = useState(scopeChip);
	const [tokens, setTokens] = useState(searchTokens);
	const [searchOpen, setSearchOpen] = useState(searchOpenSeed);
	const [navOpen, setNavOpen] = useState(navOpenSeed);
	const [railOpen, setRailOpen] = useState(intelligenceOpen);

	const trimmed = searchQuery.trim();
	const offersConversion = trimmed.length > 0 || Boolean(onMakeFilter);

	const search: SearchState = {
		query: searchQuery,
		setQuery: setSearchQuery,
		chips: chip ? [chip] : undefined,
		removeChip: () => setChip(undefined),
		sections: searchSections,
		loading: searchLoading,
		scope: searchScope,
		tokens: tokens.map((label) => ({
			label,
			onRemove: () => setTokens((prev) => prev.filter((t) => t !== label)),
		})),
		recentSearches,
		...(searchSuggestions ? { suggestions: searchSuggestions } : {}),
		makeFilter: offersConversion
			? {
					onClick: onMakeFilter ?? (() => undefined),
					blockedReason: makeFilterBlockedReason,
				}
			: undefined,
	};

	const nav = (
		<NavSidebar
			accounts={navAccounts}
			selectedNavId={selectedNavId}
			briefUnseen={unreadCount ?? 0}
			calendarNav={calendarNav}
			savedSearches={savedSearches}
			saveableQuery={
				trimmed.length > 0 && !savedSearches.includes(trimmed)
					? trimmed
					: undefined
			}
		/>
	);

	const list = listOverride ?? (
		<ListPane
			title={listTitle}
			unreadCount={unreadCount}
			sections={sections}
			briefFilters={briefFilters}
			briefCategory={briefCategory}
			briefSource={briefSource}
			filterOpen={filterOpen}
			listState={listState}
			selectedIds={selectedIds}
			onVerb={onVerb}
			preset={preset}
			selectedThreadId={selectedThreadId}
			onSelectThread={onSelectThread}
			searchResultsInBody={searchResultsInBody}
			singlePane={singlePane}
			isPhone={isPhone}
			search={search}
			searchOpen={searchOpen}
			searchCommitted={searchCommitted}
			onSearchOpenChange={setSearchOpen}
		/>
	);

	return (
		<AppShellSlotted
			initialWidth={width}
			nav={nav}
			topBar={
				singlePane ? undefined : (
					<TopBar search={search} onCompose={onCompose} />
				)
			}
			list={list}
			listBias={listBias}
			reading={
				singlePane || readingPane === "off"
					? undefined
					: (reading ?? (
							<ReadingPane
								thread={thread}
								intelligenceOpen={railOpen}
								canToggleIntelligence={Boolean(thread && intelligence)}
								onToggleIntelligence={() => setRailOpen((open) => !open)}
							/>
						))
			}
			intelligence={
				intelligence ? (
					<IntelligencePanel
						data={intelligence}
						calendar={calendar}
						defaultTab={intelligenceTab}
						onClose={() => setRailOpen(false)}
						touch={singlePane}
						className="h-full w-full border-l-0"
					/>
				) : undefined
			}
			intelligenceOpen={railOpen}
			hasThread={Boolean(thread)}
			overlay={overlay ?? (singlePane ? <ComposeFab /> : undefined)}
			isLoading={isLoading}
			skeleton={
				<div className="flex h-full w-full items-center justify-center bg-canvas text-sm text-fg-muted">
					Cold load — the route paints this skeleton before config arrives.
				</div>
			}
			navOpen={navOpen}
			onOpenNav={() => setNavOpen(true)}
			onCloseNav={() => setNavOpen(false)}
		/>
	);
}
