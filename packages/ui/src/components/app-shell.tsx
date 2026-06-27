import { useState } from "react";
import { AppShellSlotted, useAppShellLayout } from "./app-shell-slotted.js";
import {
	type AppShellProps,
	type BriefCategoryFilter,
	type NarrowView,
} from "./app-shell-types.js";
import { IntelligencePanel } from "./intelligence-panel.js";
import { MessageListPane } from "./message-list-pane.js";
import { MobileMessagePane } from "./mobile-message-pane.js";
import { NavSidebar } from "./nav-sidebar.js";
import { ReadingPane } from "./reading-pane.js";

/* ------------------------------------------------------------------ */
/* Data-driven shell: maps thread/sections/intelligence props into the */
/* slots of AppShellSlotted, which owns the responsive panel layout    */
/* and the 1024/1280 breakpoints. This component is the kit's preview / */
/* Storybook surface; the layout lives in exactly one place (slotted).  */
/* ------------------------------------------------------------------ */

export function AppShell({
	accounts,
	initialWidth,
	selectedNavId,
	briefUnseen,
	listTitle,
	listMeta,
	sections,
	briefFilters,
	flatList,
	listState,
	searchQuery,
	onRetry,
	onReportError,
	briefCategory,
	onSelectBriefCategory,
	selectedThreadId,
	thread,
	initialNarrowView = "list",
	initialTouchState,
	intelligence,
	intelligenceOpen = true,
	density,
	onSelectNav,
	onSelectThread,
	onToggleIntelligence,
}: AppShellProps) {
	/* Below the reading boundary the single pane swaps in place between the list
	   and a dedicated message view; above it the thread fills the reading pane and
	   narrowView is unused. */
	const [narrowView, setNarrowView] = useState<NarrowView>(initialNarrowView);
	/* Category lives here when uncontrolled so the brief and the nav expando
	   share one axis; a controlled `briefCategory`/`onSelectBriefCategory` pair
	   overrides it. */
	const [internalCategory, setInternalCategory] = useState<BriefCategoryFilter>(
		briefCategory ?? "all",
	);
	const activeCategory = briefCategory ?? internalCategory;
	const selectCategory = (category: BriefCategoryFilter) => {
		setInternalCategory(category);
		onSelectBriefCategory?.(category);
	};

	const nav = (
		<NavSidebar
			accounts={accounts}
			selectedNavId={selectedNavId}
			briefUnseen={briefUnseen}
			onSelectNav={onSelectNav}
		/>
	);

	const list = (
		<AppShellList
			thread={thread}
			intelligence={intelligence}
			narrowView={narrowView}
			onBackToList={() => setNarrowView("list")}
			listTitle={listTitle}
			listMeta={listMeta}
			sections={sections}
			briefFilters={briefFilters}
			flatList={flatList}
			listState={listState}
			searchQuery={searchQuery}
			onRetry={onRetry}
			onReportError={onReportError}
			briefCategory={activeCategory}
			selectedThreadId={selectedThreadId}
			density={density}
			onSelectThread={(id) => {
				setNarrowView("message");
				onSelectThread?.(id);
			}}
			onSelectBriefCategory={selectCategory}
			initialTouchState={initialTouchState}
		/>
	);

	const reading = (
		<AppShellReading
			thread={thread}
			intelligence={intelligence}
			intelligenceOpen={intelligenceOpen}
			onToggleIntelligence={onToggleIntelligence}
		/>
	);

	return (
		<AppShellSlotted
			initialWidth={initialWidth}
			nav={nav}
			list={list}
			reading={reading}
			intelligence={
				intelligence ? (
					<IntelligencePanel
						data={intelligence}
						onClose={onToggleIntelligence}
						className="h-full w-full border-l-0"
					/>
				) : undefined
			}
			intelligenceOpen={intelligenceOpen}
			hasThread={Boolean(thread)}
			density={density}
		/>
	);
}

/* ------------------------------------------------------------------ */
/* Slot adapters: read the slotted shell's layout context so they      */
/* render the right narrow/wide variant inside each pane.              */
/* ------------------------------------------------------------------ */

function AppShellList({
	thread,
	intelligence,
	narrowView,
	onBackToList,
	listTitle,
	listMeta,
	sections,
	briefFilters,
	flatList,
	listState,
	searchQuery,
	onRetry,
	onReportError,
	briefCategory,
	selectedThreadId,
	density,
	onSelectThread,
	onSelectBriefCategory,
	initialTouchState,
}: Pick<
	AppShellProps,
	| "thread"
	| "intelligence"
	| "listTitle"
	| "listMeta"
	| "sections"
	| "briefFilters"
	| "flatList"
	| "listState"
	| "searchQuery"
	| "onRetry"
	| "onReportError"
	| "selectedThreadId"
	| "density"
	| "onSelectThread"
	| "initialTouchState"
> & {
	narrowView: NarrowView;
	onBackToList: () => void;
	briefCategory: BriefCategoryFilter;
	onSelectBriefCategory: (category: BriefCategoryFilter) => void;
}) {
	const layout = useAppShellLayout();
	const showReadingPane = layout?.showReadingPane ?? false;
	const showNavPane = layout?.showNavPane ?? true;

	/* Below the reading boundary, opening a thread swaps the single pane for a
	   dedicated message view; at/above it the reading pane carries the thread. */
	if (!showReadingPane && narrowView === "message" && thread) {
		return (
			<MobileMessagePane
				thread={thread}
				intelligence={intelligence}
				onBack={onBackToList}
			/>
		);
	}

	return (
		<MessageListPane
			listTitle={listTitle}
			listMeta={listMeta}
			sections={sections ?? []}
			briefFilters={briefFilters}
			flatList={flatList}
			listState={listState}
			searchQuery={searchQuery}
			onRetry={onRetry}
			onReportError={onReportError}
			briefCategory={briefCategory}
			selectedThreadId={selectedThreadId}
			density={density}
			onSelectThread={onSelectThread}
			onSelectBriefCategory={onSelectBriefCategory}
			onOpenNav={showNavPane ? undefined : layout?.openNav}
			isDesktop={showReadingPane}
			initialTouchState={initialTouchState}
		/>
	);
}

function AppShellReading({
	thread,
	intelligence,
	intelligenceOpen,
	onToggleIntelligence,
}: Pick<
	AppShellProps,
	"thread" | "intelligence" | "intelligenceOpen" | "onToggleIntelligence"
>) {
	const layout = useAppShellLayout();
	const isWide = layout?.showIntelligencePane ?? false;
	const showIntelligence =
		isWide &&
		Boolean(intelligence) &&
		Boolean(intelligenceOpen) &&
		Boolean(thread);
	return (
		<ReadingPane
			thread={thread}
			intelligenceOpen={showIntelligence}
			onToggleIntelligence={onToggleIntelligence}
			showIntelligenceToggle={
				isWide && Boolean(intelligence) && Boolean(thread)
			}
		/>
	);
}
