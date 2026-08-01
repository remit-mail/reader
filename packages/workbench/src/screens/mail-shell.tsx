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
 *   FAB, and the phone's magnifier opens the full-screen `MobileSearchView`.
 *
 * See `packages/web-client/src/routes/mail.tsx`, `MailTopBar`, `MailListHeader`
 * and `MailViewChrome` for the originals.
 */
import {
	AppShellSlotted,
	Avatar,
	Button,
	FilterPanelProvider,
	type FilterPreset,
	FilterSheet,
	FilterToggle,
	type IntelligenceData,
	IntelligencePanel,
	MakeFilterAction,
	MessageListPane,
	MobileSearchView,
	NavSidebar,
	ReadingPane,
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
	type ThreadData,
	type ThreadSection,
	useSuggestList,
} from "@remit/ui";
import { Pencil, Search, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { navAccounts } from "../fixtures/workspace.js";
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
	unreadCount?: number;
	sections?: ThreadSection[];
	/** Brief mode: collapsible sections that own their filter row. */
	briefFilters?: boolean;
	/** Plain mailbox: one flat list with the filter sheet slotted above it. */
	preset?: FilterPreset;
	thread?: ThreadData;
	/** The list row the open thread belongs to. */
	selectedThreadId?: string;
	intelligence?: IntelligenceData;
	intelligenceOpen?: boolean;
	isLoading?: boolean;
	/** The scope the route carries into the field, e.g. `in:spam`. */
	scopeChip?: SearchChip;
	/** Seeds the search field; a non-empty query swaps the list body for results. */
	query?: string;
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

function TopBar({ search }: { search: SearchState }) {
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
			onCompose={() => undefined}
			onReportBug={() => undefined}
			onOpenSettings={() => undefined}
			composeShortcut="c"
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
	preset,
	selectedThreadId,
	singlePane,
	isPhone,
	search,
	searchOpen,
	onSearchOpenChange,
}: {
	title: string;
	unreadCount: number;
	sections: ThreadSection[];
	briefFilters?: boolean;
	preset?: FilterPreset;
	selectedThreadId?: string;
	singlePane: boolean;
	isPhone: boolean;
	search: SearchState;
	searchOpen: boolean;
	onSearchOpenChange: (open: boolean) => void;
}) {
	const suggest = useShellSuggest(search);
	const [category, setCategory] = useState("all");
	const [filters, setFilters] = useState<ReadonlySet<string>>(new Set());
	const triage = useListTriage(sections);

	const hasQuery = search.query.trim().length > 0;
	const searchExpanded = singlePane && (searchOpen || hasQuery);
	const filterConfig = preset && {
		categories: preset.categories,
		filters: preset.filters,
		sources: preset.sources,
		selectedCategory: category,
		activeFilters: filters,
		onSelectCategory: setCategory,
		onToggleFilter: (id: string) =>
			setFilters((prev) => {
				const next = new Set(prev);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			}),
		onClear: () => {
			setCategory("all");
			setFilters(new Set());
		},
	};

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
			flatList={!briefFilters}
			selectedThreadId={selectedThreadId}
			isDesktop={!singlePane}
			selection={triage.paneSelection}
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
	const inner: ReactNode = hasQuery ? results : rows;
	// A query owns the pane: the filter sheet stands down and the search's own
	// affordance takes its place, in the pane rather than in the results body, so
	// it stays put when the body swaps between the panel and the list's own rows.
	const sheet = hasQuery ? undefined : filterConfig;
	// The brief's own sections carry a sheet; a plain mailbox gets one here.
	const briefOwnsSheet = Boolean(briefFilters) && !hasQuery;
	const body = sheet ? (
		<FilterSheet {...sheet}>{inner}</FilterSheet>
	) : (
		<div className="h-full overflow-y-auto">{inner}</div>
	);

	return (
		<FilterPanelProvider hasSheet={sheet !== undefined || briefOwnsSheet}>
			<section className="flex h-full w-full flex-col bg-surface">
				<ListSelectionBar
					triage={triage}
					title={title}
					titleMeta={
						<>
							<span className="shrink-0 text-2xs text-fg-subtle">
								{unreadCount.toLocaleString()} unread
							</span>
							<FilterToggle />
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
							</>
						)
					}
					idleSlot={
						hasQuery &&
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
	preset,
	thread,
	selectedThreadId,
	intelligence,
	intelligenceOpen = true,
	isLoading,
	scopeChip,
	query = "",
	searchSections = [],
	searchLoading,
	searchScope,
	searchTokens = [],
	makeFilterBlockedReason,
	recentSearches,
	savedSearches = [],
	searchSuggestions,
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
		makeFilter: {
			onClick: () => undefined,
			blockedReason: makeFilterBlockedReason,
		},
	};

	const trimmed = searchQuery.trim();
	const nav = (
		<NavSidebar
			accounts={navAccounts}
			selectedNavId={selectedNavId}
			briefUnseen={unreadCount}
			savedSearches={savedSearches}
			saveableQuery={
				trimmed.length > 0 && !savedSearches.includes(trimmed)
					? trimmed
					: undefined
			}
		/>
	);

	const list = (
		<ListPane
			title={listTitle}
			unreadCount={unreadCount}
			sections={sections}
			briefFilters={briefFilters}
			preset={preset}
			selectedThreadId={selectedThreadId}
			singlePane={singlePane}
			isPhone={isPhone}
			search={search}
			searchOpen={searchOpen}
			onSearchOpenChange={setSearchOpen}
		/>
	);

	return (
		<AppShellSlotted
			initialWidth={width}
			nav={nav}
			topBar={singlePane ? undefined : <TopBar search={search} />}
			list={list}
			reading={
				singlePane ? undefined : (
					<ReadingPane
						thread={thread}
						intelligenceOpen={railOpen}
						canToggleIntelligence={Boolean(thread && intelligence)}
						onToggleIntelligence={() => setRailOpen((open) => !open)}
					/>
				)
			}
			intelligence={
				intelligence ? (
					<IntelligencePanel
						data={intelligence}
						onClose={() => setRailOpen(false)}
						className="h-full w-full border-l-0"
					/>
				) : undefined
			}
			intelligenceOpen={railOpen}
			hasThread={Boolean(thread)}
			overlay={singlePane ? <ComposeFab /> : undefined}
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
