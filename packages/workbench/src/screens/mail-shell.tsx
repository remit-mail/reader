/**
 * MailShell — the shell the live `/mail` route mounts, wired to fixtures.
 *
 * The app composes `AppShellSlotted` itself: it fills the nav, top-bar, list,
 * reading and intelligence slots with its own components rather than handing
 * data to the kit's `AppShell`. Anything that renders those slots differently is
 * a design that does not exist, so this file mirrors the route's own wiring:
 *
 * - the top bar is desktop-only, carries the one search field and the global
 *   actions, and starts on the list's left edge;
 * - the list pane is a `MailHeader` over the pane body, and the header shows a
 *   search field only where the top bar is absent, so the page never has two;
 * - a query swaps the list body for the same `SearchResults` sections the phone
 *   takeover renders, under the same `FilterSheet`;
 * - below 1024px the shell is one pane: the nav is a slide-over, compose is the
 *   FAB, and the phone's magnifier opens the full-screen `MobileSearchView`.
 *
 * See `packages/web-client/src/routes/mail.tsx`, `MailTopBar`, `MailListHeader`
 * and `MailViewChrome` for the originals.
 */
import {
	AppShellSlotted,
	AppTopBar,
	Avatar,
	Button,
	type FilterPreset,
	FilterSheet,
	type IntelligenceData,
	IntelligencePanel,
	MailHeader,
	MessageListPane,
	MobileSearchView,
	NavSidebar,
	ReadingPane,
	SearchBar,
	type SearchChip,
	type SearchResult,
	type SearchResultSection,
	SearchResults,
	type SearchScope,
	type ThreadData,
	type ThreadSection,
	useAppShellLayout,
} from "@remit/ui";
import { Bug, Pencil, SquarePen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { navAccounts } from "../fixtures/workspace.js";

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
	recentSearches?: string[];
	savedSearches?: string[];
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
}

function TopBar({ search }: { search: SearchState }) {
	return (
		<AppTopBar
			search={
				<SearchBar
					value={search.query}
					onChange={search.setQuery}
					onClear={() => search.setQuery("")}
					onClearQuery={() => search.setQuery("")}
					chips={search.chips}
					onRemoveChip={search.removeChip}
					placeholder={
						search.chips?.length ? "Search this folder" : "Search all mail"
					}
					size="lg"
				/>
			}
			actions={
				<>
					<Button
						variant="ghost"
						size="sm"
						icon={<SquarePen className="size-4" />}
						title="Compose (c)"
						aria-label="Compose"
					/>
					<Button
						variant="ghost"
						size="sm"
						icon={<Bug className="size-4" />}
						title="Report a problem"
						aria-label="Report a problem"
					/>
					<button type="button" aria-label="Account" className="ml-1">
						<Avatar name="Matthijs" email="matthijs@example.com" size="sm" />
					</button>
				</>
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
	const layout = useAppShellLayout();
	const [category, setCategory] = useState("all");
	const [filters, setFilters] = useState<ReadonlySet<string>>(new Set());
	const [expanded, setExpanded] = useState(false);

	const hasQuery = search.query.trim().length > 0;
	const filterConfig = preset && {
		categories: preset.categories,
		filters: preset.filters,
		sources: preset.sources,
		selectedCategory: category,
		activeFilters: filters,
		expanded,
		onExpandedChange: setExpanded,
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
			/>
		);
	}

	const rows = (
		<MessageListPane
			hideHeader
			listTitle={title}
			sections={sections}
			briefFilters={briefFilters}
			flatList={!briefFilters}
			selectedThreadId={selectedThreadId}
			isDesktop={!singlePane}
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
	const body = filterConfig ? (
		<FilterSheet {...filterConfig}>{inner}</FilterSheet>
	) : (
		<div className="h-full overflow-y-auto">{inner}</div>
	);

	return (
		<section className="flex h-full w-full flex-col bg-surface">
			<MailHeader
				title={title}
				unreadCount={unreadCount}
				isDesktop={false}
				showSearch={singlePane}
				onMenuClick={() => layout?.openNav()}
				searchValue={search.query}
				onSearchChange={search.setQuery}
				onSearchClear={() => search.setQuery("")}
				searchOpen={searchOpen}
				onSearchOpenChange={onSearchOpenChange}
			/>
			<div className="min-h-0 flex-1">{body}</div>
		</section>
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
	recentSearches,
	savedSearches = [],
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
